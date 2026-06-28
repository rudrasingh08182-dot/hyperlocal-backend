const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const { checkReturnEligibility, processReturnRequest } = require('./return.service');

router.post('/check', auth, role('buyer'), async (req, res) => {
  try {
    const { orderItemId, reason } = req.body;
    const result = await checkReturnEligibility(orderItemId, reason, new Date());
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/request', auth, role('buyer'), async (req, res) => {
  try {
    const { orderItemId, reason, evidenceImageUrl } = req.body;
    const result = await processReturnRequest(orderItemId, reason, evidenceImageUrl);
    res.status(201).json({ message: 'Return request submitted', return: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;