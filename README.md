CAUTION: This project isn't yet ready for use by humans.

Tests: [![CircleCI](https://circleci.com/gh/Opteo/oxen-queue.svg?style=svg)](https://circleci.com/gh/Opteo/oxen-queue)

# Oxen Queue

A no-frills, high-throughput worker queue backed by MySQL.

### Features:

*   Job persistence
*   Job priority
*   Job deduplication
*   Concurrency
*   Delayed jobs
*   Multi-process/server operation

## Motivation

Oxen is designed to help you chew through a very high number of jobs by leveraging significant concurrency. It is resilient to misbehaving jobs, dropped database connections, and other ills. At Opteo, we mostly use it to work though scheduled batch tasks that aren't reasonable to run in a fat Promise.all().

There are already several great job queue libraries out there, but in the context of our use-cases, they either struggled with a high number of jobs, handled unexpected disconnections poorly, or had issues with race conditions.

You'll be happy with Oxen if you:

*   Have many, many jobs (millions per day isn't unreasonable)
*   You're more interested in throughput than latency when it comes to job completion
*   You want to be able to run arbitrary queries on the queue using SQL
*   You're already running MySQL, and you don't want to add a another database to your stack (eg. Kafka)

Oxen isn't for you if:

*   You need retry mechanisms for failed jobs
*   Your jobs are user-facing and need to start in sub-second latencies
*   You need a UI, and you don't want to hack something together yourself
*   Using MySQL for a queue makes you feel icky

## Installation

**Infrastructure Requirements**:

*   Node 7 or higher
*   MySQL

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

### Adding Jobs

Jobs are added using `addJob()` or `addJobs()`

```javascript
const Oxen = require('oxen-queue')

const ox = new Oxen({ /* Initialisation args here */ }}

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

// adding many jobs at once (batched insert)
ox.addJobs([
    { body : 'we' },
    { body : 'all' }
    { body : 'live' }
    { body : 'in' }
    { body : 'a' }
    { body : 'yellow' }
    { body : 'submarine' }
])
```

All `addJob` options that can be used when calling `addJob({...}`:

| option     | required? | default      | type       | description                                                                                                                                                            |
| ---------- | --------- | ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| body       | required  | N/A          | Any        | The job body. Will be `JSON.stringify`'ed before saving to mysql.                                                                                                      |
| unique_key | optional  | `null`       | String/Int | Used for job deduplication. If you try to add two jobs with the same `unique_key`, Oxen will discard the second one. This constraint is removed once the job finishes. |
| priority   | optional  | `Date.now()` | Int        | Defines the order that jobs will start processing. Smaller numbers will run first. Defaults to the current timestamp in milliseconds, so jobs will be popped `fifo` .  |

### Consuming Jobs

Jobs are consumed using `process()`.

```javascript
const Oxen = require('oxen-queue')

const ox = new Oxen({ /* Initialisation args here */ }}

ox.process({
    work_fn : async function (job_body) {
        // Do something with your job here
        console.log(job_body)

        // The job will be considered finished when the promise resolves,
        // or failed when the promise rejects.
    }
    concurrency : 80,
    timeout : 60 * 5,
    recover_stuck_jobs : false,
})
```

All options that can be used with `process()`:

| option             | required? | default | type           | description                                                                                                                                                                                                                                                                   |
| ------------------ | --------- | ------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| work_fn            | required  | N/A     | Async Function | Your work function. It only takes one argument (here `job_body`), which is the body defined in `addJob()`. It must return a `Promise`.                                                                                                                                        |
| concurrency        | optional  | 3       | Int            | The number of jobs that Oxen will run at the same time. Higher numbers here allow Oxen to batch job fetches, increasing throughput.                                                                                                                                           |
| timeout            | optional  | 60      | Int (seconds)  | Jobs that don't return before the timeout elapses will be marked as failed.                                                                                                                                                                                                   |
| recover_stuck_jobs | optional  | true    | Bool           | If the process running Oxen is killed while jobs are still processing, jobs can get "stuck" in a processing state where Oxen no longer tries to run them. If `recover_stuck_jobs` is `true`, Oxen will check for stuck jobs every minute and put them back in a queued state. |

### Performance

A few notes about Oxen's Performance.

*   Assuming instantaneously-finishing jobs, the max throughput of Oxen depends on your `concurrency` and `fastest_polling_rate`. Since Oxen batches job fetches with a size of `concurrency`, an instance polling 10 times per second with a `concurrency` of 3 will at the maximum run 30 jobs per second. That said, if your jobs are so quick that you're limited by Oxen itself, Oxen may not be right for you.
*   Oxen will never query for another set of jobs if the previous query still hasn't returned. Nor will it try to query any more jobs if the there aren't any available `concurrency` slots. This means that you can set a very aggressive `fastest_polling_rate` without hobbling your database -- a `fastest_polling_rate` of 2ms will never actually poll every 2ms, since mysql just doesn't query that fast!
*   Thanks to the `polling_backoff_rate`, queues without any jobs will quickly go back to their `slowest_polling_rate`. At at `slowest_polling_rate` of `10000`, Oxen will only query your database every 10 seconds. This means that after a period of inactivity, Oxen may take up to 10 seconds to start any new jobs that are added.
*   **important** Jobs are never removed from your database. It's up to you to clean them up when you no longer need their results or failure stacktraces. If you don't do this, your Oxen table may become very large! Even when very large (100GB+) it will still perform fine, but it becomes difficult to manually query anything that hasn't been carefully indexed.

### Internals

A big part of Oxen's appeal is that you can query it for your own uses. At the minimum, you'll probably want to query jobs for their **results** or **failure** messages.

In more advanced cases, you may want to add [custom fields](#extra-fields) so that Oxen can be more tightly integrated into the rest of your application.

#### Data Storage

For your reference, here's the minimum schema of the table that Oxen uses:

```sql
CREATE TABLE `oxen_queue` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `batch_id` bigint(20) unsigned DEFAULT NULL,
  `job_type` varchar(200) NOT NULL,
  `created_ts` datetime DEFAULT CURRENT_TIMESTAMP,
  `started_ts` datetime DEFAULT NULL,
  `body` varchar(1000) DEFAULT NULL,
  `status` varchar(100) NOT NULL DEFAULT 'waiting',
  `result` mediumtext,
  `recovered` tinyint(1) NOT NULL DEFAULT '0',
  `running_time` smallint(5) unsigned DEFAULT NULL,
  `unique_key` int(11) unsigned DEFAULT NULL,
  `priority` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_key` (`unique_key`),
  KEY `created_ts` (`created_ts`),
  KEY `status` (`status`),
  KEY `locking_update_v2` (`job_type`,`batch_id`,`status`,`priority`),
  KEY `next_jobs_select` (`batch_id`,`priority`),
  KEY `started_ts` (`started_ts`,`job_type`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

Here's what the fields mean:

*   **`id`** the job ID.
*   **`batch_id`** used to avoid race conditions when running Oxen on independent Node.js processes.
*   **`job_type`** a queue's indentifier
*   **`created_ts`** when the job was created and marked as `waiting`
*   **`started_ts`** when the job was marked as `processing` and passed over to your `work_fn()`
*   **`body`** the job body
*   **`status`** determines the lifecycle of a job. Can be `waiting`, `processing`, `success`, `error`, `stuck`
*   **`result`** if the status is `success`, it will contain the return value of your `work_fn` in JSON. If the status is `error`, it will contain the error message and stacktrace
*   **`recovered`** default `0`, will be set to `1` if the job was recovered from a `stuck` status.
*   **`running_time`** the number of seconds during which the job was `processing`. Not actually read by Oxen, but useful for sanity checking.
*   **`unique_key`** used for job deduplication. Depends on a mysql unique index.
*   **`priority`** used for choosing which jobs to run first. Within a `job_type`, lower numbers will be processed first.

#### Extra Fields

If you add an extra column to your `oxen_queue` table, Oxen will automatically populate that field for you based on what you pass into `job_body`.

Here's an example:

```javascript
/*
    This example assumes that you've added the fields user_id and payment_method to the oxen_queue table.
*/

const Oxen = require('oxen-queue')

// initialize a queue with an extra_fields array
const ox = new Oxen({
    mysql_config: { ... },
    job_type: 'sync_user_subscription_statuses',
    extra_fields : ['user_id', 'payment_method']
})

// add a job with those extra_fields as keys in your job_body
ox.addJob({
    body: {
        user_id: 123,
        payment_method: 'paypal',
        some_other_thing : { whatever : 'value'}
    }
})

// done! Your database table will now have the user_id and payment_method fields.  
```

##### Why add them as their own fields? They're already in the job_body...

Because you can index them! In our previous example, if you add an indexes to `user_id` and `payment_method`, you'll be able to query your table very effectively:

```sql
    # Show all failing jobs for user_id 123
    SELECT created_ts, started_ts, running_time, body, result
    FROM oxen_queue
    WHERE user_id = 123 AND STATUS = 'error';


    # Show average running time per payment_method for jobs started in the last 6 hours.
    SELECT payment_method, AVG(running_time)
    FROM oxen_queue
    WHERE started_ts > (NOW() - INTERVAL 6 HOUR)
    GROUP BY payment_method;
```
