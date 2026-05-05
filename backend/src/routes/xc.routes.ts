import { Router } from 'express';
import {
  getM3U,
  getPlayerApi,
  getXmltv,
  proxyHls,
  redirectLiveStream,
  redirectTimeshiftStream,
  redirectMovieStream,
  redirectSeriesEpisodeStream,
} from '../controllers/xc.controller.js';

const router = Router();

router.get('/get.php', getM3U);
router.get('/player_api.php', getPlayerApi);
router.get('/panel_api.php', getPlayerApi);
router.get('/xmltv.php', getXmltv);
router.get('/hls/:sessionId', proxyHls);
router.get('/live/:username/:password/:streamId.:ext', redirectLiveStream);
router.get('/live/:username/:password/:streamId', redirectLiveStream);
router.get('/timeshift/:username/:password/:duration/:start/:streamId.:ext', redirectTimeshiftStream);
router.get('/timeshift/:username/:password/:duration/:start/:streamId', redirectTimeshiftStream);
router.get('/movie/:username/:password/:vodId.:ext', redirectMovieStream);
router.get('/movie/:username/:password/:vodId', redirectMovieStream);
router.get('/series/:username/:password/:episodeId.:ext', redirectSeriesEpisodeStream);
router.get('/series/:username/:password/:episodeId', redirectSeriesEpisodeStream);

export default router;
