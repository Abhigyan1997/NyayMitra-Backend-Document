// middleware/verifyToken.js
const jwt = require('jsonwebtoken');

const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] ||
      req.cookies?.token ||
      req.query?.token;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    // Verify using shared secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach minimal user info to request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role
      // Add other minimal necessary claims
    };

    next();
  } catch (error) {
    console.error('Token verification error:', error);

    let message = 'Unauthorized: Invalid token';
    if (error.name === 'TokenExpiredError') {
      message = 'Unauthorized: Token expired';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Unauthorized: Invalid token';
    }

    return res.status(401).json({ error: message });
  }
};



// Export as a single function
module.exports = verifyToken;