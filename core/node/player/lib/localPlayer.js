import { log, colors, globals, services } from 'dmt/common';

import fs from 'fs';

import Playlist from './playlist';
import Mpv from './engines/mpv';

import setupUserActionHandlers from './userActionHandlers';
import measurePlaytime from './measurePlaytime';

const DEFAULT_SKIP_SECONDS = 20;

const RESET_IDLE_TIME_LIMIT_MIN = 5;
const TIME_LIMIT_TIMEOUT = RESET_IDLE_TIME_LIMIT_MIN * 60 * 1000;

class LocalPlayer {
  constructor({ program }) {
    this.program = program;

    this.engine = new Mpv(program);

    this.playlist = new Playlist({ program });

    this.program.on('player:connected', ({ currentSongPath, paused, isStream }) => {
      this.initPlayer({ currentSongPath, paused, isStream });
    });

    this.engine.on('media_finished', () => {
      this.onMediaFinished();
    });

    program.on('tick', () => {
      const player = program.store('player').get();

      if (!player.paused && !this.isStream()) {
        measurePlaytime({ program, player: this });
      }

      if (player.timeLimit) {
        if (player.paused) {
          if (
            player.idleSince &&
            Date.now() - player.idleSince > TIME_LIMIT_TIMEOUT &&
            player.timeLimitSetAt &&
            Date.now() - player.timeLimitSetAt > TIME_LIMIT_TIMEOUT
          ) {
            this.removeTimeLimit({ announce: true });
          }
        } else {
          let remainingTime = player.timeLimit - globals.tickerPeriod / 60;
          if (remainingTime < 0) {
            remainingTime = 0;
          }
          if (remainingTime == 0) {
            log.cyan('Pausing because time limit was reached.');
            this.pause();
            this.removeTimeLimit({ announce: false });
            this.program.store('player').update({ timeLimitReached: true });
          } else {
            this.program.store('player').update({ timeLimit: remainingTime }, { announce: false });
          }
        }
      }
    });
  }

  mapToLocal(providerResults) {
    return this.program.mapToLocal ? this.program.mapToLocal(providerResults) : providerResults;
  }

  onMediaFinished() {
    if (this.isStream()) {
      log.magenta('stream finished (either network conditions or user stopped it by manual action)');
      return;
    }

    const { limit } = this.program.store('player').get();
    const limitStr = limit ? ` (limit: ${limit})` : '';
    log.yellow(`Player: finished media ${this.playlist.currentIndex + 1} of ${this.playlist.count()}${limitStr}`);

    if (this.inProcessOfStopping) {
      this.inProcessOfStopping = false;
      return;
    }

    const limitReached = this.decrementLimit();

    if (limitReached) {
      log.cyan('Stopping media play because limit was reached');

      this.program.store('player').update({ limitReached: true });

      this.playlist.selectNextMedia();
      this.playlist.rollover();
      this.playlist.broadcastPlaylistState();
      return;
    }

    const playNext = () =>
      this.next({ fromAction: false })
        .then(() => {
          if (!this.program.store('player').get('repeatCount')) {
            this.playlist.rollover();
          }
        })
        .catch(() => {
          this.timeLimit('reset');
        });

    playNext();
  }

  initPlayer({ currentSongPath, paused, isStream }) {
    const { updatedFromMpvPlayerState } = this.playlist.init(currentSongPath, isStream);
    this.initVolume();

    setupUserActionHandlers({ program: this.program, player: this });

    if (!updatedFromMpvPlayerState) {
      paused = true;
    }

    this.program.store('player').update({ paused, currentMedia: { songPath: currentSongPath } });

    this.program.emit('player:initialized', this.program.store('player').get());

    this.initialized = true;
  }

  isInitialized() {
    return this.initialized;
  }

  initVolume() {
    const currentVolume = this.program.store('player').get('volume');
    const defaultDeviceVolume = services('player').try('defaultVolume.mpv');
    const defaultVolume = parseInt(defaultDeviceVolume) || 75;

    if (currentVolume != null) {
      log.write(`Setting mpv volume to ${colors.magenta(currentVolume)} from saved program state`);
    } else if (defaultDeviceVolume != null) {
      log.write(`Setting mpv volume to ${colors.cyan(defaultDeviceVolume)} from device.def entry: ${colors.cyan('player.defaultVolume.mpv')}`);
    } else {
      log.write(
        `Setting mpv volume to ${colors.yellow(defaultVolume)} (hard-coded global default) since volume was not saved in program state or defined in device.def`
      );
    }

    const volume = currentVolume == null ? defaultVolume : currentVolume;

    if (volume != null) {
      this.program.store('player').update({ volume });
    } else {
      this.program.store('player').removeKey('volume');
    }
  }

  removeLimitNotifications() {
    this.program.store('player').removeKey('limitReached', { announce: false });
    this.program.store('player').removeKey('timeLimitReached', { announce: false });
  }

  async play({ files = [] } = {}) {
    return new Promise((success, reject) => {
      if (files.length == 0) {
        if (this.hasLoadedMedia()) {
          this.removeLimitNotifications();

          this.engine.play().then(() => {
            this.status()
              .then(success)
              .catch(reject);
          });
        } else {
          if (this.playlist.isEmpty()) {
            const msg = 'Called play on an empty playlist, nothing to do ...';
            log.yellow(msg);
            reject(new Error(msg));
            return;
          }

          this.playCurrent()
            .then(() => {
              this.status()
                .then(success)
                .catch(reject);
            })
            .catch(() => {
              reject(new Error('Playback error'));
            });
        }

        return;
      }

      this.program.store('player').removeKey('limit', { announce: false });

      this.playlist.clear();
      this.playlist.prepareNumbering();

      this.add({ files });
      this.playCurrent()
        .then(success)
        .catch(() => {
          log.red('Playback error: stopped');
        });
    });
  }

  playUrl(url) {
    this.removeLimitNotifications();

    return new Promise((success, reject) => {
      this.engine
        .play(url)
        .then(success)
        .catch(e => {
          log.red(`Problem playing url ${colors.yellow(url)}: ${e.message}`);
          reject(e);
        });
    });
  }

  playRadio(radioId) {
    let url = '';
    switch (radioId) {
      case 'jazz':
        url = 'http://us4.internet-radio.com:8266/stream';
        break;
      case 'rock':
        url = 'http://198.58.98.83:8258/stream';
        break;
      case 'classical':
        url = 'http://174.36.206.197:8000/listen.pls?sid=1';
        break;
      case 'christmas':
        url = 'http://46.105.118.14:24000';
        break;
      case 'ambient':
        url = 'http://uk2.internet-radio.com:31491';
        break;
      case 'progressive-trance':
        url = 'http://81.88.36.42:8010/listen.pls?sid=1';
        break;
      case 'goa-trance':
        url = 'http://81.88.36.42:8030/listen.pls?sid=1';
        break;
      default:
        break;
    }

    if (url) {
      this.playUrl(url).then(() => {
        log.green(`Play radio: ${colors.yellow(radioId)}`);
      });
    }
  }

  async add({ files }) {
    const filePathToLoad = this.playlist.add(files);
    if (filePathToLoad && !this.isStream()) {
      this.load(filePathToLoad);
    }
  }

  async insert({ files }) {
    this.playlist.insert(files);
  }

  async cut(args) {
    return this.playlist.cut(args);
  }

  cutSelected() {
    this.playlist.cutSelected();
  }

  async paste() {
    this.playlist.paste();
  }

  setNext() {
    this.playlist.setSelectedAsNext();
  }

  async bump(args = '') {
    const rangePatternOrStr = args.toString();

    if (rangePatternOrStr.match(/[a-zA-Z]/)) {
      return this.playlist.bumpSearch(rangePatternOrStr);
    }

    if (rangePatternOrStr.trim() == '') {
      return this.playlist.bumpSelected();
    }

    return this.playlist.bump(rangePatternOrStr);
  }

  async songsToBump(terms) {
    return this.playlist.songsToBump(this.playlist.searchPlaylist(terms));
  }

  async sublist(tag) {
    switch (tag) {
      case 'andreja':
        this.bump('roisin murphy, cigarettes after sex, moloko, erlend oye, prljavo kazaliste, zaz french, Rhye woman, sade artist, inxs');
        break;
      case 'david':
        this.bump(
          'metallica, cigarettes after sex, prljavo kazaliste, mariza, madredeus, joe satriani, ozric tentacles, eat static, astropilot, cabeiri, shadow gallery, inxs'
        );
        break;
      case 'irma':
        this.bump('oliver dragojevic');
        break;
      case 'otroci':
        this.bump('romana kranjcan');
        break;
      default:
        this.bump(tag);
        break;
    }
  }

  async shuffle() {
    this.playlist.shuffle();
  }

  async repeat() {
    const maxRepeat = 3;

    let { repeatCount } = this.program.store('player').get();

    if (repeatCount == null) {
      repeatCount = 1;
    } else {
      repeatCount += 1;
    }

    if (repeatCount > maxRepeat) {
      repeatCount = undefined;
    }

    this.program.store('player').update({ repeatCount });

    return { repeatCount };
  }

  decrementLimit() {
    if (this.program.store('player').get('repeatCount')) {
      return false;
    }

    const { limit } = this.program.store('player').get();

    if (limit > 1) {
      this.program.store('player').update({ limit: limit - 1 }, { announce: false });
    } else if (limit == 1) {
      this.program.store('player').removeKey('limit', { announce: false });
      return true;
    }

    return false;
  }

  next({ songId = undefined, fromAction = true } = {}) {
    if (this.playlist.songList().length > 1) {
      this.engine.clearTimeposition();
    }

    return new Promise((success, reject) => {
      this.playNext({ songId, fromAction })
        .then(success)
        .catch(reject);
    });
  }

  playNext({ songId, fromAction } = {}) {
    return new Promise((success, reject) => {
      if (songId) {
        this.playlist
          .selectMedia(songId)
          .then(() => {
            this.playCurrent()
              .then(success)
              .catch(reject);
          })
          .catch(reject);
      } else {
        const cont = () => {
          this.playCurrent()
            .then(song => {
              this.playlist.broadcastPlaylistState();
              success(song);
            })
            .catch(reject);
        };

        if (!fromAction && this.program.store('player').get('repeatCount')) {
          let { repeatCount } = this.program.store('player').get();
          if (repeatCount == 1) {
            repeatCount = null;
          } else {
            repeatCount -= 1;
          }
          this.program.store('player').update({ repeatCount });
          cont();
        } else if (this.playlist.selectNextMedia() != null) {
          this.program.store('player').removeKey('repeatCount');
          if (fromAction) {
            this.decrementLimit();
          }
          cont();
        } else {
          reject(new Error('Cannot play next media (?)'));
        }
      }
    });
  }

  playCurrent() {
    this.removeLimitNotifications();

    return new Promise((success, reject) => {
      const song = this.playlist.currentSong();
      log.green('Playing song 🎵');

      fs.access(song.path, fs.constants.R_OK, err => {
        if (err) {
          this.playlist.markError(song);

          const msg = `${colors.gray(song.path)} doesn't exist on file system`;
          log.red(msg);

          reject(new Error(msg));
          return;
        }

        if (song.error) {
          this.playlist.unmarkError(song);
          this.playlist.rescanMissingMedia();
        }

        log.dir(song);

        this.engine
          .play(song.path)
          .then(() => {
            success({ song });
          })
          .catch(reject);
      });
    });
  }

  load(filePath) {
    this.engine
      .load(filePath)
      .then(() => this.engine.pause())
      .catch(() => log.error(`⚠️ Problem loading ${filePath}`));
  }

  pause() {
    return new Promise((success, reject) => {
      this.engine
        .pause()
        .then(() => {
          success();
        })
        .catch(reject);
    });
  }

  toggleSelected(songId) {
    this.playlist.toggleSelected(songId);
  }

  limit(num) {
    return new Promise((success, reject) => {
      let limit;

      if (num != 'reset' && num != '0' && num != 0) {
        num = parseInt(num);

        limit = this.program.store('player').get('limit');

        if (num) {
          limit = num;
        } else if (!limit) {
          limit = 1;
        } else if (this.playlist.currentIndex + limit < this.playlist.count()) {
          limit += 1;
        }
      }

      limit = Math.min(limit, this.playlist.count() - this.playlist.currentIndex);

      this.program.store('player').update({ limit }, { announce: false });
      this.removeTimeLimit({ announce: false });

      this.playlist.broadcastPlaylistState();

      success({ limit });
    });
  }

  timeLimit(num) {
    return new Promise((success, reject) => {
      let timeLimit;

      if (num != 'reset' && num != '0' && num != 0) {
        num = parseInt(num);

        timeLimit = this.program.store('player').get('timeLimit');

        if (num) {
          timeLimit = num;
        } else if (!timeLimit) {
          timeLimit = 3;
        } else if (timeLimit < 4) {
          timeLimit = 5;
        } else if (timeLimit < 9) {
          timeLimit = 10;
        } else if (timeLimit < 25) {
          timeLimit += 10;
          if (timeLimit > 30) {
            timeLimit = 30;
          }
        } else {
          timeLimit += 30;
        }
      }

      if (!this.isStream()) {
        this.program.store('player').removeKey('limit', { announce: false });
      }

      if (timeLimit == undefined) {
        this.removeTimeLimit({ announce: false });
      } else {
        const timeLimitSetAt = Date.now();
        this.program.store('player').update({ timeLimit, timeLimitSetAt });
      }
      this.playlist.broadcastPlaylistState();

      success();
    });
  }

  removeTimeLimit({ announce = true } = {}) {
    this.program.store('player').removeKey('timeLimitSetAt', { announce: false });
    this.program.store('player').removeKey('timeLimit', { announce });
  }

  forward(seconds = DEFAULT_SKIP_SECONDS) {
    return new Promise((success, reject) => {
      this.engine
        .forward({ seconds })
        .then(success)
        .catch(reject);
    });
  }

  backward(seconds = DEFAULT_SKIP_SECONDS) {
    return this.forward(-Math.abs(seconds));
  }

  goto(seconds) {
    seconds = seconds || 0;

    return new Promise((success, reject) => {
      this.engine
        .seek({ seconds })
        .then(success)
        .catch(reject);
    });
  }

  similar() {
    return new Promise((success, reject) => {
      this.playlist.similar();
      success();
    });
  }

  gotoPercentPos(percentPos) {
    if (!this.program.store('player').get('paused')) {
      const duration = this.mediaDuration();
      if (duration) {
        const timepos = percentPos * duration;
        this.goto(timepos);
      }
    }
  }

  hasLoadedMedia() {
    return this.program.store('player').get('currentMedia')?.songPath;
  }

  mediaDuration() {
    return this.program.store('player').get('currentMedia')?.duration;
  }

  isStream() {
    return this.program.store('player').get('isStream');
  }

  stop() {
    this.removeTimeLimit({ announce: false });

    if (this.isStream()) {
      return new Promise((success, reject) => {
        this.engine
          .stop()
          .then(() => {
            success();
          })
          .catch(reject);
      });
    }

    return new Promise((success, reject) => {
      if (!this.hasLoadedMedia()) {
        success();
      } else {
        this.inProcessOfStopping = true;
        this.playlist.deselectCurrent();
        this.playlist.broadcastPlaylistState();

        this.engine
          .stop()
          .then(success)
          .catch(reject);
      }
    });
  }

  clear() {
    return new Promise((success, reject) => {
      success();
    });
  }

  list() {
    return new Promise((success, reject) => {
      success({ playlist: this.playlist.songList(), currentSongId: this.playlist.currentSongId() });
    });
  }

  status() {
    return new Promise((success, reject) => {
      const status = JSON.parse(JSON.stringify(this.program.store('player').get()));
      delete status.playlist;
      success({ status });
    });
  }

  volume(vol) {
    const prevVolume = this.program.store('player').get('volume');
    let newVolume;

    const DEFAULT_VOLUME_STEP = 5;

    const volumeStep = parseInt(services('player').volumeStep || DEFAULT_VOLUME_STEP);

    if (vol == 'up') {
      newVolume = Math.min(100, prevVolume + volumeStep);
    } else if (vol == 'down') {
      newVolume = Math.max(0, prevVolume - volumeStep);
    } else if (!Number.isNaN(parseInt(vol))) {
      newVolume = parseInt(vol);
      if (newVolume < 0) {
        newVolume = 0;
      }
      if (newVolume > 100) {
        log.magenta(`Invalid volume value passed (vol = ${colors.red(vol)}) — ${colors.red('not adjusting volume')}`);
        newVolume = prevVolume;

        return new Promise((success, reject) => {
          success({
            prevVolume,
            volume: prevVolume
          });
        });
      }
    }

    return new Promise((success, reject) => {
      this.engine
        .volume(newVolume)
        .then(volume => {
          success({
            prevVolume,
            volume
          });
        })
        .catch(reject);
    });
  }
}

export default LocalPlayer;
