const crypto = require('crypto')

const _ = require('lodash')
const mysql = require('mysql2')
const Promise = require('bluebird')

const storage = require('./storage')

const error_messages = {
    no_job_type:
        'Must specify the job type e.g. const ox = new oxen_queue({ job_type: "weekly_emails" ... })',
    already_processing: `This queue is already processing`,
    work_fn_missing: `Missing work_fn argument, nothing to do! Remember that the process() function takes an object as its single argument.`,
    invalid_concurrency: `The concurrency argument must be a number`,
    no_mysql_connection: `Must supply mysql_config argument. It should look something like: const ox = new oxen_queue({ mysql_config: { host : 'foo.net', password : 'secret'} ... }).`,
}

const queue = class {
    constructor({
        /* Default settings */
        job_type,
        mysql_config,
        db_table = 'oxen_queue',
        extra_fields = [],
        fastest_polling_rate = 100,
        slowest_polling_rate = 10000,
        polling_backoff_rate = 1.1,
        onJobSuccess = async () => {},
        onJobError = async () => {},
    }) {
        if (!mysql_config) {
            throw new Error(error_messages['no_mysql_connection'])
        }

        if (!job_type) {
            throw new Error(error_messages['no_job_type'])
        }

        /* Queue */
        this.job_type = job_type
        this.extra_fields = extra_fields
        this.processing = false
        this.currently_fetching = false
        this.in_process = 0
        this.working_job_batch = []
        this.job_recovery_interval = null
        this.stop_processing = false

        /* Callbacks */
        this.onJobError = onJobError
        this.onJobSuccess = onJobSuccess

        /* Database */
        this.db = mysql.createPool(mysql_config).promise()
        this.db_table = db_table

        /* Polling */
        this.polling_rate = fastest_polling_rate
        this.fastest_polling_rate = fastest_polling_rate
        this.slowest_polling_rate = slowest_polling_rate
        this.polling_backoff_rate = polling_backoff_rate
    }

    async addJob(job) {
        await this.addJobs([job])
    }

    async addJobs(jobs) {
        if (jobs.length === 0) {
            return
        }

        const fields = [
            'body',
            'job_type',
            'unique_key',
            'priority',
            'created_ts',
            ...this.extra_fields,
        ]

        await this.dbQry(
            `
                insert into ${this.db_table} (
                    ${fields.join(',')}
                ) 
                VALUES ? 
                ON DUPLICATE KEY UPDATE 
                priority = IF(priority > VALUES(priority), VALUES(priority), priority)
            `,
            [
                jobs.map(job => {
                    if (_.isUndefined(job.body)) {
                        job = { body: job }
                    }

                    const unique_key = _.isUndefined(job.unique_key)
                        ? null
                        : parseInt(
                              crypto
                                  .createHash('md5')
                                  .update(`${job.unique_key}|${this.job_type}`)
                                  .digest('hex')
                                  .slice(0, 8),
                              16
                          )

                    const created_ts = job.start_time ? new Date(job.start_time) : new Date()

                    const inserts = [
                        JSON.stringify(job.body),
                        this.job_type,
                        unique_key,
                        _.isNumber(job.priority) ? job.priority : Date.now(),
                        created_ts,
                    ]

                    this.extra_fields.forEach(field => {
                        inserts.push(job.body[field])
                    })

                    return inserts
                }),
            ]
        )
    }

    async process({ work_fn, concurrency = 3, timeout = 60, recover_stuck_jobs = true }) {
        const _this = this

        if (_this.processing) {
            throw new Error(error_messages['already_processing'])
        }
        if (!work_fn) {
            throw new Error(error_messages['work_fn_missing'])
        }

        if (!_.isNumber(concurrency)) {
            throw new Error(error_messages['invalid_concurrency'])
        }

        _this.batch_size = concurrency
        _this.job_timeout_seconds = Math.floor(timeout)

        _this.processing = true

        async function loop() {
            if (_this.in_process < concurrency) {
                _this.in_process++

                _this
                    .doWork(work_fn)
                    .then(() => {
                        _this.in_process--
                    })
                    .catch(error => {
                        _this.in_process--
                        _this.log('Unhandled Oxen Queue error:')
                        _this.log(error)
                    })
            } else if (_this.polling_rate < _this.slowest_polling_rate) {
                _this.polling_rate *= _this.polling_backoff_rate
            }

            if (!_this.processing) {
                return
            }

            setTimeout(function () {
                if (!_this.processing) {
                    return
                }

                loop()
            }, _this.polling_rate)
        }

        loop()

        this.job_recovery_interval = setInterval(function () {
            if (recover_stuck_jobs) {
                _this.recoverStuckJobs().catch(function (error) {
                    _this.log('Unable to recover stuck jobs:')
                    _this.log(error)
                })
            } else {
                _this.markStuckJobs().catch(function (error) {
                    _this.log('Unable to mark stuck jobs:')
                    _this.log(error)
                })
            }
        }, 1000 * 60) //every minute
    }

    stopProcessing() {
        this.processing = false
        clearInterval(this.job_recovery_interval)
    }

    async doWork(work_fn) {
        const _this = this

        const job = await this.getNextJob()

        if (!job) {
            if (_this.polling_rate < _this.slowest_polling_rate) {
                _this.polling_rate *= _this.polling_backoff_rate
            } else if (_this.polling_rate >= _this.slowest_polling_rate) {
                _this.polling_rate = _this.slowest_polling_rate
            }

            return Promise.resolve('no_job')
        }

        this.polling_rate = this.fastest_polling_rate

        return Promise.resolve(work_fn(job.body))
            .timeout(
                _this.job_timeout_seconds * 1000,
                `timeout for job_id ${job.id} (over ${_this.job_timeout_seconds} seconds)`
            )
            .then(async job_result => {
                return _this.handleSuccess({ job_id: job.id, job_result, job_body: job.body })
            })
            .catch(async error => {
                //job failed
                return _this.handleError({ job_id: job.id, error, job_body: job.body })
            })
    }

    async getNextJob() {
        const _this = this
        if (!this.currently_fetching && this.working_job_batch.length < this.batch_size) {
            this.currently_fetching = true

            await this.fillJobBatch().catch(error => {
                _this.log('There was an error while trying to get the next set of jobs:')
                _this.log(error)
            })
            this.currently_fetching = false
        }
        return this.working_job_batch.shift()
    }

    async fillJobBatch() {
        const batch_id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

        const locked_batch = await this.dbQry(
            `
            UPDATE ${this.db_table} AS main
            INNER JOIN (
                SELECT id FROM ${this.db_table} FORCE INDEX (locking_update)
                WHERE batch_id IS NULL 
                AND STATUS = "waiting" 
                AND ? 
                AND created_ts <= NOW()
                ORDER BY priority ASC LIMIT ${this.batch_size}
            ) sub
            ON sub.id = main.id
            SET ?, STATUS = "processing", started_ts = NOW()`,
            [{ job_type: this.job_type }, { batch_id }]
        )

        if (locked_batch.changedRows === 0) {
            return false
        }

        const next_jobs = await this.dbQry(
            `SELECT id, body FROM ${this.db_table} WHERE ? ORDER BY priority ASC LIMIT ${this.batch_size}`,
            { batch_id }
        )

        if (next_jobs.length === 0) {
            return false
        }

        next_jobs.forEach(job => {
            job.body = JSON.parse(job.body)
            this.working_job_batch.push(job)
        })

        return true
    }

    async handleSuccess({ job_id, job_result, job_body }) {
        await this.onJobSuccess({ job_id, job_body, job_type: this.job_type, job_result })
        return this.dbQry(
            `
            update ${this.db_table} 
            set 
                ?, 
                unique_key = NULL,
                status="success",
                running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW())  
            where ? 
            LIMIT 1`,
            [
                {
                    result: JSON.stringify(job_result),
                },
                {
                    id: job_id,
                },
            ]
        )
    }

    async handleError({ job_id, error, job_body }) {
        await this.onJobError({ job_id, job_body, job_type: this.job_type, error })
        return this.dbQry(
            `
            update ${this.db_table} 
            set 
                ?, 
                unique_key = NULL,
                status="error", 
                running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW()) 
            where ? 
            LIMIT 1`,
            [
                {
                    result: error.stack,
                },
                {
                    id: job_id,
                },
            ]
        )
    }

    async recoverStuckJobs() {
        //reset jobs that are status=processing and have been created over 2 mins ago
        return this.dbQry(
            `
            UPDATE ${this.db_table} 
            SET 
                STATUS="waiting", 
                batch_id = NULL, 
                started_ts = NULL, 
                recovered = 1 
            WHERE 
                STATUS="processing" AND 
                started_ts < (NOW() - INTERVAL ${this.job_timeout_seconds} SECOND) AND
                ?
            `,
            { job_type: this.job_type }
        )
    }

    async markStuckJobs() {
        //mark jobs that are status=processing and have been created over 2 mins ago
        return this.dbQry(
            `
            UPDATE ${this.db_table} 
            SET 
                STATUS="stuck", 
                unique_key = NULL, 
                recovered = 1 
            WHERE 
                STATUS="processing" AND 
                started_ts < (NOW() - INTERVAL ${this.job_timeout_seconds} SECOND) AND
                ?
            `,
            { job_type: this.job_type }
        )
    }

    async dbQry(query, params) {
        const errors_to_retry = [
            'ER_LOCK_WAIT_TIMEOUT',
            'ER_LOCK_DEADLOCK',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'try restarting transaction',
        ]

        let retries = 5

        while (retries > 0) {
            try {
                const [result] = await this.db.query(query, params)

                return result
            } catch (e) {
                retries--
                if (retries === 0 || !errors_to_retry.some(msg => e.message.includes(msg))) {
                    throw e
                }
            }

            await Promise.delay(Math.random() * 500 + 500)
        }
    }

    async createTable() {
        const query = storage.create_table.replace('[[TABLE_NAME]]', this.db_table)
        return this.dbQry(query)
    }

    async deleteTable() {
        const query = storage.delete_table.replace('[[TABLE_NAME]]', this.db_table)
        return this.dbQry(query)
    }

    async selectEntireTable() {
        const query = storage.select_entire_table.replace('[[TABLE_NAME]]', this.db_table)
        return this.dbQry(query)
    }

    debug() {
        return {
            processing: this.processing,
            in_process: this.in_process,
            currently_fetching: this.currently_fetching,
            working_job_batch: this.working_job_batch,
        }
    }

    log(msg, not_error) {
        console[not_error ? 'log' : 'error'](`Oxen Queue: ${msg}`)
    }
}

module.exports = {
    queue,
    error_messages,
}
