const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const { getMyNotifications, markAllRead } = require('./notification.controller');

router.get('/', auth, getMyNotifications);
router.patch('/mark-all-read', auth, markAllRead);

module.exports = router;