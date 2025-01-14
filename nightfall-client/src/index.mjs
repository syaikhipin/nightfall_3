import config from 'config';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import mongo from '@polygon-nightfall/common-files/utils/mongo.mjs';
import { queueManager } from '@polygon-nightfall/common-files/utils/event-queue.mjs';
import app from './app.mjs';
import rabbitmq from './utils/rabbitmq.mjs';
import queues from './queues/index.mjs';
import { initialClientSync } from './services/state-sync.mjs';
import { startEventQueue, eventHandlers } from './event-handlers/index.mjs';

let _isSyncing = true;
const main = async () => {
  // we want to have endpoints responding as soon as possible, but prevent
  // them from taking action before syncing is complete. So, we have a variable
  // _isSyncing that informs if client is syncing. On the other hand,
  // a middleware function is checking this variable. If client is still syncing,
  // it will just return a 400
  app.listen(80);
  app.set('isSyncing', _isSyncing);
  try {
    if (process.env.ENABLE_QUEUE) {
      await rabbitmq.connect();
      queues();
    }

    await mongo.connection(config.MONGO_URL); // get a db connection
    await startEventQueue(queueManager, eventHandlers);
    initialClientSync().then(() => {
      _isSyncing = false;
      app.set('isSyncing', _isSyncing);
    });
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

main();
