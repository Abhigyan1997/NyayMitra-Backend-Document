// Dummy middleware for demo purposes
module.exports = (req, res, next) => {
  req.user = { id: "12345", email: "test@example.com" }; // simulate authenticated user
  next();
};
