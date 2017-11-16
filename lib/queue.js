const uuid = require('node-uuid') // maybe use node crypto instead of dependency?
const _  = require('lodash')
const mysql  = require('mysql')

const db = require('./storage')

const error_messages = {
    no_job_type : 'Must specify the job type e.g. oxen({ job_type: "weekly_emails" })',
    already_processing : `This queue is already processing`,
    work_fn_missing : `Missing work_fn argument, nothing to do! Remember that the process() function takes an object as its single argument.`,
    invalid_concurreny : `The concurrency argument must be a number`,
    no_mysql_connection : `Must supply mysql_connection argument. It should look something like oxen({ mysql_connection : { host : 'foo.net', password : 'secret'}}).`,
    invalid_batch_size : `The batch_size argument must be a number`,
}

const queue = class {

    constructor({ 
        /* Default settings */
        job_type,
        mysql_connection,
        db_table = 'common.background_jobs_queue',
        polling_rate = 100,
        batch_size = 10,
        max_polling_rate = 100,
        min_polling_rate = 10000,
        backoff_polling_rate = 1.1,
     }) {

        if(!mysql_connection) {
            throw new Error(error_messages['no_mysql_connection'])
        }

        if(!job_type) {
            throw new Error(error_messages['no_job_type'])
        }

        if(!_.isNumber(batch_size)){
            throw new Error(error_messages['invalid_batch_size'])
        }

        this.job_type = job_type

        /* Queue */
        this.started = false
        this.currently_fetching = false
        this.in_process = 0
        this.in_process_jobs = []
        this.batch_size = batch_size
        this.working_job_batch = []

        /* Database */
        this.db = mysql.createPool(mysql_connection);
        this.db_table = db_table
        
        /* Polling */
        this.polling_rate = polling_rate
        this.max_polling_rate = max_polling_rate
        this.min_polling_rate = min_polling_rate
        this.backoff_polling_rate = backoff_polling_rate
    }

    async addJob(job) {
        return this.addJobs([job])
    }

    async addJobs(jobs) {
        if(jobs.length === 0){
            return
        }

        const fields = [
            'body', 
            'job_type', 
            'unique_key', 
            'priority',
            'created_ts',
            ...extra_fields
        ]

        return this.dbQry(`
                insert into ${this.db_table} (
                    ${fields.join(',')}
                ) 
                VALUES ? 
                ON DUPLICATE KEY UPDATE id=id
            `, 
            [jobs.map(function (job) {
                
                if(!job.body){
                    job = { body : job }
                }

                const unique_key = _.isUndefined(job.unique_key) ? null : murmurhash.v3('' + job.unique_key)

                const created_ts = job.start_time ? moment(job.start_time).utc().format('YYYY-MM-DD HH:mm:ss') : moment().utc().format('YYYY-MM-DD HH:mm:ss')

                const inserts = [
                    JSON.stringify(job.body),
                    job_type,
                    unique_key,
                    _.isNumber(job.priority) ? job.priority : _.now(),
                    created_ts
                ]

                extra_fields.forEach(field => {
                    inserts.push(job.body[field])
                })

                return inserts
            })]
        )
    }

    async process({ work_fn, concurrency = 3, timeout = 60, recover_stuck_jobs = true }) {
        const _this = this

        if(_this.started){
            throw new Error(error_messages['already_processing'])
        }
        if(!work_fn){
            throw new Error(error_messages['work_fn_missing'])
        }

        if(!_.isNumber(concurrency)){
            throw new Error(error_messages['invalid_concurreny'])
        }

        _this.batch_size = concurrency
        _this.job_timeout_seconds = Math.floor(timeout)

        _this.started = true

        async function loop(){

            if(_this.in_process < concurrency){
                _this.in_process++

                _this.doWork(work_fn).then(() => {
                    _this.in_process--
                }).catch((error) => {
                    _this.in_process--
                    _this.log('Unhandled Oxen Queue error:')
                    _this.log(error)
                })
            }
            else if(_this.polling_rate < _this.slowest_polling_rate) {
                _this.polling_rate *= _this.polling_backoff_rate
            }

            setTimeout(function () {
                loop()
            }, _this.polling_rate)
        }

        loop()

        setInterval(function () {

            if(recover_stuck_jobs){
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

   async doWork(work_fn) {
        const _this = this

        const job = await this.getNextJob()

        if(!job){
            if(_this.polling_rate < _this.slowest_polling_rate){
                _this.polling_rate *= _this.polling_backoff_rate
            } 
            else if (_this.polling_rate >= _this.slowest_polling_rate){
                _this.polling_rate = _this.slowest_polling_rate
            }

            return Promise.resolve('no_job')
        }

        this.polling_rate = this.fastest_polling_rate

        const job_clone = _.clone(job)

        job_clone.started_time = moment().format()

        this.in_process_jobs.push(job_clone)

        return Promise.resolve(work_fn(job.body)).timeout(_this.job_timeout_seconds * 1000, 'timeout on work_fn(job.body)').then(async (job_result) => {
            _.remove(this.in_process_jobs, { id : job.id })
            return _this.handleSuccess({ job_id : job.id, job_result })

        }).catch(async (error) => { //job failed
            _.remove(this.in_process_jobs, { id : job.id })
            return _this.handleError({ job_id : job.id, error })
        })
    }

    async getNextJob() {
        if(!this.currently_fetching && this.working_job_batch.length < this.batch_size){
            this.currently_fetching = true
            await this.fillJobBatch().catch((error) => {
                _this.log('There was an error while trying to get the next set of jobs:')
                _this.log(error)
            })
            this.currently_fetching = false
        }

        return this.working_job_batch.shift()
    }

    async fillJobBatch() {
        const batch_id = Math.floor((Math.random() * Number.MAX_SAFE_INTEGER))

        const locked_batch = await this.dbQry(`
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
            SET ?, STATUS = "processing", started_ts = NOW()`, [
                { job_type },
                { batch_id }
            ]
        )

        if(locked_batch.changedRows === 0){
            return false
        }

        const next_jobs = await this.dbQry(`SELECT id, body FROM ${this.db_table} WHERE ? ORDER BY priority ASC LIMIT ${this.batch_size}`, {
            batch_id
        }) 

        if(next_jobs.length === 0){
            return false
        }

        next_jobs.forEach((job) => {
            job.body = JSON.parse(job.body)
            this.working_job_batch.push(job)
        })

        
        return true
    }

    async handleSuccess ({ job_id, job_result }) {
        return this.dbQry(`
            update ${this.db_table} 
            set 
                ?, 
                unique_key = NULL,
                status="success",
                running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW())  
            where ? 
            LIMIT 1`, [{
                result : JSON.stringify(job_result)
            }, {
                id : job_id
            }])
    }

    async handleError ({ job_id, error }) {
        return this.dbQry(`
            update ${this.db_table} 
            set 
                ?, 
                unique_key = NULL,
                status="error", 
                running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW()) 
            where ? 
            LIMIT 1`, [{
                result : error.stack
            }, {
                id : job_id
            }])
    }

    async recoverStuckJobs (){
        //reset jobs that are status=processing and have been created over timeout
        return this.dbQry(`UPDATE ${this.db_table} SET STATUS="waiting", batch_id = NULL, started_ts = NULL, recovered = 1 \
                            WHERE STATUS="processing" AND created_ts < (NOW() - INTERVAL ${this.job_timeout_seconds} SECOND)`)
    }

    async markStuckJobs (){
        //mark jobs that are status=processing and have been created over timeout
        return this.dbQry(`UPDATE ${this.db_table} SET STATUS="stuck", unique_key = NULL, recovered = 1 \
                        WHERE STATUS="processing" AND created_ts < (NOW() - INTERVAL ${this.job_timeout_seconds} SECOND)`)
    }

    async dbQry (query, params) {
        return new Promise((resolve, reject) => {
            this.db.query(query, params, (err, result) => {
                if(err){
                    reject(err)
                }
                else {
                    resolve(result)
                }
            })
        })
    }

    log (msg, not_error){
        console[not_error ? 'log' : 'error'](`Oxen Queue: ${msg}`)
    }
}

module.exports = {
    queue,
    error_messages
}