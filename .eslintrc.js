module.exports = {
  env: {
    node: true,
    commonjs: true,
    es2021: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    'no-undef': 'off', // Nonaktifkan no-undef untuk Node.js globals
    'no-unused-vars': 'warn'
  },
  globals: {
    require: 'readonly',
    module: 'readonly',
    __dirname: 'readonly',
    process: 'readonly',
    console: 'readonly'
  }
};