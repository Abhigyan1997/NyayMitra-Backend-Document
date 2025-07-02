const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema({
  // User Information (using unique string ID instead of reference)
  userId: {
    type: String,
    required: true,
    index: true  // Adding index for better query performance
  },
  userEmail: {
    type: String,
    required: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },

  // Service Details
  serviceType: {
    type: String,
    enum: ['document-download', 'legal-consultation', 'document-review', 'other'],
    required: true
  },
  serviceName: {
    type: String,
    required: true
  },
  documentType: {
    type: String,
    enum: ['agreement', 'affidavit', 'complaint', 'contract', 'other'],
    required: function () { return this.serviceType === 'document-download'; }
  },

  // Payment Information
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR',
    enum: ['INR', 'USD', 'EUR']
  },
  discountApplied: {
    type: Number,
    default: 0
  },
  finalAmount: {
    type: Number,
    required: true
  },

  // Order Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  statusHistory: [{
    status: String,
    changedAt: Date,
    reason: String
  }],

  // Document Information
  documentUrl: {
    type: String,
    validate: {
      validator: function (v) {
        return /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/.test(v);
      },
      message: props => `${props.value} is not a valid URL!`
    }
  },
  documentVersion: {
    type: String,
    default: '1.0'
  },
  downloadCount: {
    type: Number,
    default: 0
  },

  // Delivery Information
  deliveryMethod: {
    type: String,
    enum: ['email', 'download', 'both', 'none'],
    default: 'download'
  },
  deliveryStatus: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending'
  },

  // Razorpay Payment Details
  razorpayOrderId: {
    type: String,
    unique: true,
    sparse: true
  },
  razorpayPaymentId: {
    type: String,
    unique: true,
    sparse: true
  },
  razorpaySignature: String,

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  paymentAt: Date,
  completedAt: Date,
  expiresAt: {
    type: Date,
    default: function () {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from creation
    }
  },

  // Additional Metadata
  ipAddress: String,
  userAgent: String,
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true,  // Adds createdAt and updatedAt automatically
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
serviceOrderSchema.index({ userId: 1, status: 1 });
serviceOrderSchema.index({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $exists: true } } });
serviceOrderSchema.index({ razorpayPaymentId: 1 }, { unique: true, partialFilterExpression: { razorpayPaymentId: { $exists: true } } });
serviceOrderSchema.index({ createdAt: 1 });
serviceOrderSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // For automatic expiry

// Pre-save hook to calculate final amount
serviceOrderSchema.pre('save', function (next) {
  if (this.isModified('price') || this.isModified('discountApplied')) {
    this.finalAmount = this.price - this.discountApplied;
  }
  next();
});

// Method to update status with history tracking
serviceOrderSchema.methods.updateStatus = function (newStatus, reason = '') {
  this.statusHistory.push({
    status: this.status,
    changedAt: new Date(),
    reason: reason
  });
  this.status = newStatus;
  if (newStatus === 'completed') {
    this.completedAt = new Date();
  }
};

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);