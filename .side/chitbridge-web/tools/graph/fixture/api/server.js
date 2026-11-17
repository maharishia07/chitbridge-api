/* fixture — the mount lines tools/endpoint-usage.cjs reads */
const express = () => ({ use() {} });
const app = express();
app.use('/api/books', require('./routes/books'));
module.exports = app;
