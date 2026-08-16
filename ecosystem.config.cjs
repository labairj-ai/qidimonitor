module.exports = {
  apps: [{
    name: 'qidimonitor',
    script: 'index.js',
    cwd: '/Users/ai_lab/Desktop/qidimonitor/server',
    interpreter: 'node',
    interpreter_args: '--experimental-sqlite',
    env: {
      NODE_ENV: 'production',
      PORT: '4200',
      DB_PATH: '/Users/ai_lab/qidimonitor/qidimonitor.db',
      SNAPSHOTS_DIR: '/Users/ai_lab/qidimonitor/snapshots',
    },
  }],
};
