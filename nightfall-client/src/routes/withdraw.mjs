/**
Route for transferring a crypto commitment.
*/
import express from 'express';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import withdraw from '../services/withdraw.mjs';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { rawTransaction: txDataToSign, transaction } = await withdraw(req.body);
    res.json({ txDataToSign, transaction });
  } catch (err) {
    if (err.message.includes('invalid commitment hashes')) {
      logger.info('Returning "invalid commitment hashes" error');
      res.json({ error: err.message });
    }
    logger.error(err);
    next(err);
  }
});

export default router;
