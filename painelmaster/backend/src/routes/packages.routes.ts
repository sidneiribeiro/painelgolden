import { Router } from 'express';
import * as packagesController from '../controllers/packages.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', packagesController.listPackages);
router.get('/price', packagesController.getPackagesPrice);
router.get('/trials', packagesController.getTrialPackages);
router.get('/bouquets', packagesController.listBouquets);
router.get('/:id', packagesController.getPackage);

export default router;
