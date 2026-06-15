module.exports = {
  apps: [
    {
      name: 'mathswithsd-dashboard',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
};
