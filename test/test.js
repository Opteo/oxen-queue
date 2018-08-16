const expect = require('chai').expect
const assert = require('assert')

const lib = require('../lib/queue')
const bjq = lib.queue
const messages = lib.error_messages

describe('bjq', () => {
    describe('()', () => {
        it('should create a new queue instance', () => {
            const queue = new bjq({
                mysql_connection: {},
                job_type: 'test',
                batch_size: 50,
            })
            expect(queue).to.be.instanceof(bjq)
            expect(queue.job_type).to.equal('test')
            expect(queue.batch_size).to.equal(50)
        })
        it('should fail if no job type specified', () => {
            try {
                const queue = new bjq({ mysql_connection: {} })
            } catch (err) {
                expect(err).to.not.be.null
                expect(err.message).to.equal(messages['no_job_type'])
            }
        })
    })
})
