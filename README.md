CAUTION: This project isn't yet ready for use by humans.

Tests: [![CircleCI](https://circleci.com/gh/Opteo/oxen-queue.svg?style=svg)](https://circleci.com/gh/Opteo/oxen-queue)

# Oxen Queue

A no-frills, high-throughput worker queue backed by MySQL.

### Features:

-   Job persistence
-   Job priority
-   Job deduplication
-   Concurrency
-   Delayed jobs
-   Multi-process/server operation

## Motivation

Oxen is designed to help you chew through a very high number of jobs by leveraging significant concurrency. It is resilient to misbehaving jobs, dropped database connections, and other ills. At Opteo, we mostly use it to work though scheduled batch tasks that aren't reasonable to run in a fat Promise.all().

There are already several great job queue libraries out there, but in the context of our use-cases, they either struggled with a high number of jobs, handled unexpected disconnections poorly, or had issues with race conditions.

You'll be happy with Oxen if you:

-   Have many, many jobs (millions per day isn't unreasonable)
-   You're more interested in throughput than latency when it comes to job completion
-   You want to be able to run arbitrary queries on the queue using SQL
-   You're already running MySQL, and you don't want to add a another database to your stack (eg. Kafka)

Oxen isn't for you if:

-   You need retry mechanisms for failed jobs
-   Your jobs are user-facing and need to start in sub-second latencies
-   You need a UI, and you don't want to hack something together yourself
-   Using MySQL for a queue makes you feel icky

## Installation

**Infrastructure Requirements**:

-   Node 7 or higher
-   MySQL

**NPM**

To install via npm, run:

```bash
npm install oxen-queue
```

## Usage

### Initialisation

Here's how you initialise the queue.

```javascript
const Oxen = require('oxen-queue')

const ox = new Oxen({
    mysql_config: {
        user: 'mysql_user',
        password: 'mysql_password',
        // anything else you need to pass to the mysql lib
    },
    db_table: 'oxen_queue', // (optional) name the table that oxen will use in your database.
    job_type: 'avatar_renders', // give this queue a job type. Other instances of oxen with the same job type will be the same queue.
})

/* If this is your first time running oxen, run this line to automatically create the database table. You should only need to run this once. */
await ox.createTable()
```

All constructor options that can be used when calling `new Oxen({...})`:

| option               | required? | default      | type                                                                     | description                                                                                                                                                                                                                                  |
| -------------------- | --------- | ------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mysql_config         | required  | N/A          | [Connection Object](https://github.com/mysqljs/mysql#connection-options) | This object will be used to connect to your mysql instance. Use whatever you're already using to connect to mysql. At the minimum, you'll probably need `{user: 'mysql_user', password: 'mysql_password'}`                                   |
| db_table             | optional  | `oxen_queue` | String                                                                   | The table that Oxen will use to store its jobs. If you haven't specified a database name in your `mysql_config`, you'll need to add your database as a prefix, such as `my_database.oxen_queue`                                              |
| job_type             | required  | N/A          | String                                                                   | The name of your queue, such as `newsletter_emails` or `user_sync`. Queues in other Node.js processes with the same name will share the same state.                                                                                          |
| extra_fields         | optional  | `[]`         | Array                                                                    | This array of strings allows you to add arbitary parts of your job body directly to your mysql table. Oxen will automatically pluck them out of your job body and insert them. It's up to you to alter your table to fit those extra fields. |
| fastest_polling_rate | optional  | `100`        | Int                                                                      | The shortest delay between two polls of your table (ms)                                                                                                                                                                                      |
| slowest_polling_rate | optional  | `10000`      | Int                                                                      | The longest delay between two polls of your table (ms)                                                                                                                                                                                       |
| polling_backoff_rate | optional  | `1.1`        | Int                                                                      | The rate at which Oxen will slow polling if it finds no more jobs. For example, a rate of `1.2` will cause the next poll to be done 20% later than the last one.                                                                             |

### Jobs

Each job is saved as a single row in your table. The actual job body is JSON.stringify'ed and put into a VARCHAR(1000) field, so anything that will survive that process will fit into a job. If 1000 characters isn't enough for you, feel free to alter your table to use a TEXT field.

```javascript
const oxen_queue = require('oxen-queue')

const ox = new oxen_queue({ /* Initialisation args here */ }}

// adding a job with a string body
ox.addJob({
    body : 'job_body_here'
})

// adding a job with an object body
ox.addJob({
    body : { oh : 'hello', arr : [1, 2]}
})

// shorthand for adding a job with no additional parameters
ox.addJob('job_body_here')
```

All `addJob` options:

| option     | required? | default   | type       | description                                                                                                                                                            |
| ---------- | --------- | --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| body       | required  | N/A       | Any        | The job body. Will be `JSON.stringify`'ed before saving to mysql.                                                                                                      |
| unique_key | optional  | `null`    | String/Int | Used for job deduplication. If you try to add two jobs with the same `unique_key`, Oxen will discard the second one. This constraint is removed once the job finishes. |
| priority   | optional  | `_.now()` | Int        | Defines the order that jobs will start processing. Smaller numbers will run first. Defaults to the current timestamp in milliseconds, so jobs will be popped `fifo` .  |

``

```
TODO: define all available args for addJob() and describe job consumer.
```
