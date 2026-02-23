// prisma.config.js
const { defineConfig } = require('@prisma/config');
require('dotenv').config();

module.exports = defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
  schema: './generated/prisma/schema.prisma',
});