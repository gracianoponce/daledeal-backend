const express = require('express');
const router  = express.Router();
const { getCarriers } = require('../controllers/trackingController');

// GET /shipping/carriers — correos disponibles para despachar (público)
router.get('/carriers', getCarriers);

module.exports = router;
