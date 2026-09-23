module.exports = {
  apps: [{
    name: 'sugat-api',
    cwd: '/var/www/sugat',
    script: 'apps/api/dist/src/main.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '500M',
    kill_timeout: 10_000,
    listen_timeout: 10_000,
    wait_ready: false,
    merge_logs: false,
    error_file: '/var/log/sugat/api-error.log',
    out_file: '/var/log/sugat/api-out.log',
    time: true,
    env_production: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 5002,
    },
  }],
};
