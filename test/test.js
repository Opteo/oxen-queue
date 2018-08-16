const _ = require('lodash')
const crypto = require('crypto')
const expect = require('chai').expect
const assert = require('assert')
const Promise = require('bluebird')

const lib = require('../lib/queue')
const bjq = lib.queue
const messages = lib.error_messages
const mysql_connection = require('./mysql_connection_config')
const db_table = 'oxen_queue_test'

const waitUntil = async condition => {
    while (true) {
        if (condition()) {
            break
        }
        await Promise.delay(20)
    }

    return
}

describe('oxen-queue', () => {
    describe('basic initialisation', () => {
        it('should create a new queue instance', () => {
            const queue = new bjq({
                mysql_connection: {},
                job_type: 'test',
                fastest_polling_rate: 50,
            })
            expect(queue).to.be.instanceof(bjq)
            expect(queue.job_type).to.equal('test')
            expect(queue.fastest_polling_rate).to.equal(50)
        })
        it('should fail if no job type specified', () => {
            try {
                const queue = new bjq({
                    mysql_connection,
                })
            } catch (err) {
                expect(err).to.not.be.null
                expect(err.message).to.equal(messages['no_job_type'])
            }
        })
        it('should fail if no mysql connection', () => {
            try {
                const queue = new bjq({
                    job_type: 'something',
                })
            } catch (err) {
                expect(err).to.not.be.null
                expect(err.message).to.equal(messages['no_mysql_connection'])
            }
        })
        it('should instantiate with defaults', () => {
            try {
                const queue = new bjq({
                    mysql_connection,
                    job_type: 'something',
                })
            } catch (err) {
                expect(err).to.be.null
            }
        })
    })

    describe('Connect to database and do basic operations', function() {
        this.timeout(15000)

        beforeEach(async function() {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
            })

            await queue.deleteTable()

            await queue.createTable()
        })

        it('should push and pop fifo', async () => {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
                slowest_polling_rate: 200,
                fastest_polling_rate: 2,
            })

            const jobs_in = _.range(10).map(i => {
                return {
                    some_id: i,
                    some_msg: `msg${i}`,
                }
            })

            for (i of jobs_in) {
                await queue.addJob(i)
            }

            const jobs_out = []

            queue.process({
                work_fn: async job => {
                    jobs_out.push(job)
                },
            })

            await waitUntil(() => {
                return jobs_out.length === jobs_in.length
            })

            queue.stopProcessing()

            expect(jobs_out).to.deep.equal(jobs_in)
        })

        it('should respect priority', async () => {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
                slowest_polling_rate: 200,
                fastest_polling_rate: 2,
            })

            const jobs_in = []

            for (i of _.range(10)) {
                jobs_in.push({
                    body: i,
                    priority: i,
                })
            }

            const jobs_in_shuffled = _.shuffle(jobs_in)

            await Promise.map(
                jobs_in_shuffled,
                async job => {
                    await queue.addJob(job)
                },
                { concurrency: 5 }
            )

            // give mysql a moment to breathe
            await Promise.delay(500)

            const jobs_out = []

            queue.process({
                work_fn: async job => {
                    jobs_out.push(+job)
                },
                concurrency: 1,
            })

            await waitUntil(() => {
                return jobs_out.length === jobs_in.length
            })

            queue.stopProcessing()

            expect(jobs_out).to.deep.equal(jobs_in.map(j => j.body))
        })

        it('should discard duplicate jobs', async () => {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
                slowest_polling_rate: 200,
                fastest_polling_rate: 2,
            })

            const jobs_in = [
                {
                    body: 'why',
                    unique_key: 'only_one_of_these',
                },
                {
                    body: 'hello',
                    unique_key: 'a_string_key',
                },
                {
                    body: 'there',
                    unique_key: 'a_string_key',
                },
                {
                    body: 'doctor',
                    unique_key: 7,
                },
                {
                    body: 'freeman',
                    unique_key: 7,
                },
            ]

            for (i of jobs_in) {
                await queue.addJob(i)
            }

            const jobs_out = []

            queue.process({
                work_fn: async job => {
                    jobs_out.push(job)
                },
            })

            await waitUntil(() => {
                return jobs_out.length === 3
            })

            queue.stopProcessing()

            expect(jobs_out).to.deep.equal(['why', 'hello', 'doctor'])
        })

        /*
            Note: this test is sensitive to clock drift between your database server and your testing server.
        */
        it('should delay jobs as specified', async () => {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
                slowest_polling_rate: 200,
                fastest_polling_rate: 2,
            })

            const jobs_in = [
                {
                    body: 'medium',
                    start_time: _.ceil(_.now() + 3000, -3),
                },
                {
                    body: 'short',
                    start_time: _.ceil(_.now() + 1000, -3),
                },
                {
                    body: 'long',
                    start_time: _.ceil(_.now() + 5000, -3),
                },
            ]

            for (i of jobs_in) {
                await queue.addJob(i)
            }

            const jobs_out = []

            queue.process({
                work_fn: async job => {
                    jobs_out.push(job)
                },
            })

            await Promise.delay(2000)

            expect(jobs_out.length).to.be.below(3)

            await waitUntil(() => {
                return jobs_out.length === 3
            })

            queue.stopProcessing()

            expect(jobs_out).to.deep.equal(['short', 'medium', 'long'])
        })

        it('should error out when jobs exceed timeout', async () => {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
                slowest_polling_rate: 200,
                fastest_polling_rate: 2,
            })

            await queue.addJob('watching paint dry')

            queue.process({
                work_fn: async job => {
                    await Promise.delay(2000)
                },
                timeout: 1,
            })

            await Promise.delay(2000)

            const entire_table = await queue.selectEntireTable()

            expect(entire_table[0].status).to.equal('error')

            queue.stopProcessing()
        })

        it('should save job results to the table', async () => {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
                slowest_polling_rate: 200,
                fastest_polling_rate: 2,
            })

            await queue.addJob('watching paint dry')

            queue.process({
                work_fn: async job => {
                    return { some_key: 'some_value' }
                },
            })

            await Promise.delay(1000)

            const entire_table = await queue.selectEntireTable()

            expect(entire_table[0].status).to.equal('success')
            expect(entire_table[0].result).to.equal(`{"some_key":"some_value"}`)

            queue.stopProcessing()
        })

        it('should start and stop processing without breaking', async () => {
            const queue = new bjq({
                mysql_connection,
                job_type: 'anything',
                db_table,
                slowest_polling_rate: 200,
                fastest_polling_rate: 2,
            })

            const jobs_out = []

            queue.process({
                work_fn: async job => {
                    jobs_out.push(job)
                    await Promise.delay(200)
                },
            })

            const jobs_in = _.range(100).map(i => {
                return {
                    some_id: i,
                    some_msg: `msg${i}`,
                }
            })

            await queue.addJobs(jobs_in)

            const job_count_1 = jobs_out.length

            await Promise.delay(1000)

            expect(jobs_out.length).to.be.above(job_count_1)

            queue.stopProcessing()

            //allow queue to flush
            await Promise.delay(500)

            const job_count_2 = jobs_out.length

            await Promise.delay(1000)

            expect(jobs_out.length).to.equal(job_count_2)

            queue.process({
                work_fn: async job => {
                    jobs_out.push(job)
                    await Promise.delay(200)
                },
            })

            await Promise.delay(1000)

            expect(jobs_out.length).to.be.above(job_count_1)

            queue.stopProcessing()

            //allow queue to flush
            await Promise.delay(500)

            const job_count_3 = jobs_out.length

            await Promise.delay(1000)

            expect(jobs_out.length).to.equal(job_count_3)
        })
    })
})
