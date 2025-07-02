const app = require('./app');
const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://alokabhigyan65:Abhi1997$$@sharpenerproject.msds32f.mongodb.net/DocumentService',)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(4000, () => console.log('Server running on http://localhost:4000'));
  })
  .catch(err => console.error(err));
