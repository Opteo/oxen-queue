This project isn't yet ready for use by humans.

### Example:
```javascript
const oxen = require('oxen')

const queue = new oxen({
  storage: {
    host: 'data.my-sql-server.com/n98j1ncd',
    password: 'your-database-password',
    database: 'main-database'
  },
  job_type: 'scan_user_data'
})

const users = userController.getAllUsers()
users.forEach(user => {
  queue.addJob({ user })
})

queue.process({
  concurrency: 5,
  recover_stuck_jobs: false,
  work_fn: function({ user }) {
    return userController.checkAccount(user.id)
  }
})
```