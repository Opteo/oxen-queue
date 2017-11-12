const uuid = require('node-uuid') // maybe use node crypto instead of dependency?

const db = require('./storage')

const error_messages = {
    'no-job-type': 'must specify the job type e.g. bjq({ job_type: "weekly_emails" })'
}

const queue = class {

    constructor({ 
        /* Default settings */
        job_type,
        db_table = 'background_jobs_queue',
        polling_rate = 100,
        batch_size = 10,
        max_polling_rate = 100,
        min_polling_rate = 10000,
        backoff_polling_rate = 1.1
     }) {

        if(!job_type) {
            throw new Error(error_messages['no-job-type'])
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
        this.db_table = db_table
        
        /* Polling */
        this.polling_rate = polling_rate
        this.max_polling_rate = max_polling_rate
        this.min_polling_rate = min_polling_rate
        this.backoff_polling_rate = backoff_polling_rate
    }

    addJob() {}

    addJobs() {}

    process() {}

    doWork() {}

    getNextJob() {}

    fillJobBatch() {}

    handleSuccess() {}

    handleError() {}

    recoverStuckJobs() {}

    markStuckJobs() {}

}

module.exports = {
    queue,
    error_messages
}