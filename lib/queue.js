const uuid = require('node-uuid') // maybe use node crypto instead of dependency?

const db = require('./storage')

/* e.g.
const queue = new bbq({
  db: new Database.Connection(),
  // ... other options
})
*/

const queue = class {

    constructor({ job_type }) {
        
        this.started = false
        this.in_process = 0
        this.db_table = `background_jobs_queue`
        
        this.job_timeout_minutes = 20
        this.fastest_polling_rate = 100
        this.slowest_polling_rate = 10000
        this.polling_rate = 100
        this.polling_backoff_rate = 1.1

        if(!job_type) {
            throw new Error('Must specify a job type')
        }
    }
}

// const Promise = require('bluebird')
// const moment = require('moment')
// const _ = require('lodash')
// const murmurhash = require('murmurhash')

// module.exports = function({ job_type, extra_fields = [] }){
    
//     const db_table = mode === `dev` ? `common.background_jobs_queue_v2` : `common.background_jobs_queue_v2`

//     if(!job_type){
//         throw new Error('Must specify a job type')
//     }

//     return {

//         started : false,
//         in_process : 0,
//         in_process_jobs : [],

//         fastest_polling_rate : 3,
//         slowest_polling_rate : 5000,
//         polling_rate : 20,
//         polling_backoff_rate : 1.5,

//         batch_size : 10,

//         working_job_batch : [],
//         currently_fetching : false,

//         /* jobs format :

//             {
//                 body,
//                 unique_key, (optional)
//                 priority (optional)
//             }

//         */

//         addJobs : async function(jobs) {

//             const fields = [
//                 'body', 
//                 'job_type', 
//                 'unique_key', 
//                 'priority',
//                 'created_ts',
//                 ...extra_fields
//             ]

//             return db.qry(`
//                     insert into ${db_table} (
//                         ${fields.join(',')}
//                     ) 
//                     VALUES ? 
//                     ON DUPLICATE KEY UPDATE id=id
//                 `, 
//                 [jobs.map(function (job) {
                    
//                     if(!job.body){
//                         job = { body : job }
//                     }

//                     const unique_key = _.isUndefined(job.unique_key) ? null : murmurhash.v3('' + job.unique_key)

//                     const created_ts = job.start_time ? moment(job.start_time).utc().format('YYYY-MM-DD HH:mm:ss') : moment().utc().format('YYYY-MM-DD HH:mm:ss')

//                     const inserts = [
//                         JSON.stringify(job.body),
//                         job_type,
//                         unique_key,
//                         _.isNumber(job.priority) ? job.priority : _.now(),
//                         created_ts
//                     ]

//                     extra_fields.forEach(field => {
//                         inserts.push(job.body[field])
//                     })

//                     return inserts
//                 })]
//             )
//         },

//         addJob : async function(job) {
//             return this.addJobs([job])
//         },

//         process : async function({ work_fn, concurrency = 3, timeout = 60, recover_stuck_jobs = true }){
//             const _this = this

//             if(_this.started){
//                 throw new Error('Already processing')
//             }
//             if(!work_fn){
//                 throw new Error('Need function to work on')
//             }

//             if(!_.isNumber(concurrency)){
//                 throw new Error('Concurrency must be a number')
//             }

//             _this.batch_size = concurrency
//             _this.job_timeout_seconds = Math.floor(timeout)

//             _this.started = true

//             async function loop(){

//                 if(_this.in_process < concurrency){
//                     _this.in_process++

//                     Promise.resolve(_this.doWork(work_fn)).timeout(4000 + (_this.job_timeout_seconds * 1000), 'timeout on doWork() function').then(() => {
//                         _this.in_process--
//                     }).catch((error) => {
//                         _this.in_process--
//                         console.log('THIS JOB GOOFED IN A BAD WAY!')
//                         console.log(error)
//                     })
//                 }
//                 else if(_this.polling_rate < _this.slowest_polling_rate) {
//                     _this.polling_rate *= _this.polling_backoff_rate
//                 }

//                 setTimeout(function () {
//                     loop()
//                 }, _this.polling_rate)
//             }

//             loop()

//             setInterval(function () {

//                 if(recover_stuck_jobs){
//                     _this.recoverStuckJobs().catch(function (error) {
//                         console.log('unable to recover stuck jobs:')
//                         console.log(error)
//                     })
//                 } else {
//                     _this.markStuckJobs().catch(function (error) {
//                         console.log('unable to mark stuck jobs:')
//                         console.log(error)
//                     })
//                 }

//                 // log(_this.in_process_jobs)

//             }, 1000 * 60) //every minute
//         },

//         doWork : async function(work_fn){
//             const _this = this

//             const job = await Promise.resolve(this.getNextJob()).timeout(3000, 'timeout on getNextJob() function')

//             if(!job){
//                 if(_this.polling_rate < _this.slowest_polling_rate){
//                     _this.polling_rate *= _this.polling_backoff_rate
//                 } 
//                 else if (_this.polling_rate >= _this.slowest_polling_rate){
//                     _this.polling_rate = _this.slowest_polling_rate
//                 }

//                 return Promise.resolve('no_job')
//             }

//             this.polling_rate = this.fastest_polling_rate

//             const job_clone = _.clone(job)

//             job_clone.started_time = moment().format()

//             this.in_process_jobs.push(job_clone)

//             return Promise.resolve(work_fn(job.body)).timeout(_this.job_timeout_seconds * 1000, 'timeout on work_fn(job.body)').then(async (job_result) => {
//                 _.remove(this.in_process_jobs, { id : job.id })
//                 return _this.handleSuccess({ job_id : job.id, job_result })

//             }).catch(async (error) => { //job failed
//                 _.remove(this.in_process_jobs, { id : job.id })
//                 return _this.handleError({ job_id : job.id, error })
//             })
//         },

//         getNextJob : async function() {

//             if(!this.currently_fetching && this.working_job_batch.length < this.batch_size){
//                 this.currently_fetching = true
//                 await this.fillJobBatch().catch((error) => {
//                     console.log('UH OH! there was an error while trying to get the next set of jobs:')
//                     console.log(error)
//                 })
//                 this.currently_fetching = false
//             }

//             return this.working_job_batch.shift()
//         },

//         fillJobBatch : async function(){
//             const batch_id = Math.floor((Math.random() * Number.MAX_SAFE_INTEGER))

//             const locked_batch = await db.qry(`
//                 UPDATE ${db_table} AS main
//                 INNER JOIN (
//                     SELECT id FROM ${db_table} FORCE INDEX (locking_update_v2)
//                     WHERE batch_id IS NULL 
//                     AND STATUS = "waiting" 
//                     AND ? 
//                     AND created_ts <= NOW()
//                     ORDER BY priority ASC LIMIT ${this.batch_size}
//                 ) sub
//                 ON sub.id = main.id
//                 SET ?, STATUS = "processing", started_ts = NOW()`, [
//                     { job_type },
//                     { batch_id }
//                 ]
//             )

//             if(locked_batch.changedRows === 0){
//                 return false
//             }

//             const next_jobs = await db.qry(`SELECT id, body FROM ${db_table} WHERE ? ORDER BY priority ASC LIMIT ${this.batch_size}`, {
//                 batch_id
//             }) 

//             if(next_jobs.length === 0){
//                 return false
//             }

//             next_jobs.forEach((job) => {
//                 job.body = JSON.parse(job.body)
//                 this.working_job_batch.push(job)
//             })

            
//             return true
//         },

//         handleSuccess : async function ({ job_id, job_result }) {
//             return db.qry(`
//                 update ${db_table} 
//                 set 
//                     ?, 
//                     unique_key = NULL,
//                     status="success",
//                     running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW())  
//                 where ? 
//                 LIMIT 1`, [{
//                     result : JSON.stringify(job_result)
//                 }, {
//                     id : job_id
//                 }])
//         },

//         handleError : async function ({ job_id, error }) {
//             return db.qry(`
//                 update ${db_table} 
//                 set 
//                     ?, 
//                     unique_key = NULL,
//                     status="error", 
//                     running_time = TIMESTAMPDIFF(SECOND,started_ts,NOW()) 
//                 where ? 
//                 LIMIT 1`, [{
//                     result : error.stack
//                 }, {
//                     id : job_id
//                 }])
//         },

//         recoverStuckJobs : function(){
//             //reset jobs that are status=processing and have been created over 2 mins ago
//             return db.qry(`UPDATE ${db_table} SET STATUS="waiting", batch_id = NULL, started_ts = NULL, recovered = 1 \
//                             WHERE STATUS="processing" AND created_ts < (NOW() - INTERVAL ${this.job_timeout_seconds} SECOND)`)
//         },

//         markStuckJobs : function(){
//             //mark jobs that are status=processing and have been created over 2 mins ago
//             return db.qry(`UPDATE ${db_table} SET STATUS="stuck", unique_key = NULL, recovered = 1 \
//                             WHERE STATUS="processing" AND created_ts < (NOW() - INTERVAL ${this.job_timeout_seconds} SECOND)`)
//         }
//     }
// }

module.exports = queue