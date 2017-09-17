const db = require('./db') // make this a module that is passed through the function

/* e.g.
const queue = new bbq({
  db: new Database.Connection(),
  // ... other options
})
*/

const uuid = require('node-uuid');

const queue = function({ job_type }){
    let started = false;
    let in_process = 0

    const db_table = `common.background_jobs_queue`
    const job_timeout_minutes = 20

    if(!job_type){
        throw new Error('Must specify a job type')
    }

    return {

        fastest_polling_rate : 100,
        slowest_polling_rate : 10000,
        polling_rate : 100,

        polling_backoff_rate : 1.1,

        addJob : async function(job_body) {
            return db.qry(`insert into ${db_table} set ? `, {
                user_id : job_body.user_id,
                domain_id : job_body.domain_id,
                body : JSON.stringify(job_body),
                job_type,
                status : 'waiting'
            })
        },

        addJobs : async function(job_bodies) {
            return db.qry(`insert into ${db_table} (body, job_type, status) VALUES ? `, [job_bodies.map(function (job_body) {
                return [
                    JSON.stringify(job_body),
                    job_type,
                    'waiting'
                ]
            })])
        },

        process : async function({ work_fn, concurrency = 3, timeout = 60000, recover_stuck_jobs = true }){
            const _this = this
            _this.timeout = timeout

            if(started){
                throw new Error('Already processing')
            }
            if(!work_fn){
                throw new Error('Need function to work on')
            }

            started = true

            async function loop(){

                if(in_process < concurrency){
                    _this.doWork(work_fn).then(function (res) {
                        if(res === 'no_job' && _this.polling_rate < _this.slowest_polling_rate){
                            _this.polling_rate *= _this.polling_backoff_rate
                        } 
                        else if (res === 'no_job' && _this.polling_rate >= _this.slowest_polling_rate){
                            _this.polling_rate = _this.slowest_polling_rate
                        }
                        else {
                            _this.polling_rate = _this.fastest_polling_rate
                        }
                    }).catch(function (error) {
                        console.error('THIS JOB GOOFED IN A BAD WAY!')
                        console.error(error)
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
                        console.error('unable to recover stuck jobs:')
                        console.error(error)
                    })
                } else {
                    _this.markStuckJobs().catch(function (error) {
                        console.error('unable to mark stuck jobs:')
                        console.error(error)
                    })
                }
            }, 1000 * 60) //every minute
        },

        doWork : async function(work_fn){
            const _this = this
            in_process++

            const job = await this.getNextJob()

            if(!job){
                in_process--
                return Promise.resolve('no_job')
            }

            const process_id = job.process_id

            return Promise.resolve(work_fn(job.body)).timeout(_this.timeout).then(async function (job_result) {
                await _this.handleSuccess({ process_id, job_result })
                in_process--
            }).catch(async function (error) { //job failed
                await _this.handleError({ process_id, error })
                in_process--
                return Promise.resolve()
            })
        },

        handleSuccess : async function ({ process_id, job_result }) {
            return db.qry(`update ${db_table} set ?, completed_ts = NOW(), status="success", running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW())  where ? LIMIT 1`, [{
                result : JSON.stringify(job_result)
            }, {
                process_id
            }])
        },

        handleError : async function ({ process_id, error }) {
            return db.qry(`update ${db_table} set ?, completed_ts = NOW(), status="error", running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW()) where ? LIMIT 1`, [{
                result : error.stack
            }, {
                process_id
            }])
        },

        getNextJob : async function() {
            const process_id = uuid.v4();

            const db_result = await db.qry(`UPDATE ${db_table} SET ?, status = "processing", started_ts = NOW() \
                WHERE process_id IS NULL and status = "waiting" and ? \
                ORDER BY created_ts ASC LIMIT 1`, [
                    { process_id },
                    { job_type }
                ]
            )

            if(db_result.changed_rows === 0){
                return false
            }

            let next_job = await db.qry(`SELECT body FROM ${db_table} WHERE ? LIMIT 1`, {
                process_id
            }) 

            if(next_job[0]){
                next_job = next_job[0]
                next_job.process_id = process_id
                next_job.body = JSON.parse(next_job.body)
                return next_job
            }
            return false
        },

        recoverStuckJobs : function(){
            //reset jobs that are status=processing and have been created over 2 mins ago
            return db.qry(`UPDATE ${db_table} SET STATUS="waiting", process_id = NULL, started_ts = NULL, recovered = 1 \
                            WHERE STATUS="processing" AND created_ts < (NOW() - INTERVAL ${job_timeout_minutes} MINUTE)`)
        },

        markStuckJobs : function(){
            //reset jobs that are status=processing and have been created over 2 mins ago
            return db.qry(`UPDATE ${db_table} SET STATUS="stuck", recovered = 1 \
                            WHERE STATUS="processing" AND created_ts < (NOW() - INTERVAL ${job_timeout_minutes} MINUTE)`)
        }
    }
};

module.exports = queue