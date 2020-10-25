/**
 * This module adds PubCommonId to the User ID module
 * The {@link module:modules/userId} module is required
 * @module modules/pubCommonIdSystem
 * @requires module:modules/userId
 */

import * as utils from '../src/utils.js';
import {submodule} from '../src/hook.js';
import {getStorageManager} from '../src/storageManager.js';
import {ajax} from '../src/ajax.js';

const PUB_COMMON_ID = 'PublisherCommonId';
const MODULE_NAME = 'pubCommonId';

const COOKIE = 'cookie';
const LOCAL_STORAGE = 'html5';
const SHAREDID_OPT_OUT_VALUE = '00000000000000000000000000';
const SHAREDID_URL = 'https://id.sharedid.org/id';
const SHAREDID_SUFFIX = '_sharedid';
const EXPIRED_COOKIE_DATE = 'Thu, 01 Jan 1970 00:00:01 GMT';
const SHAREDID_DEFAULT_STATE = false;

const storage = getStorageManager(null, 'pubCommonId');

/**
 * Store sharedid in either cookie or local storage
 * @param {Object} config Need config.storage object to derive key, expiry time, and storage type.
 * @param {string} value Shareid value to store
 */

function storeData(config, value) {
  try {
    if (value) {
      const key = config.storage.name + SHAREDID_SUFFIX;
      const expiresStr = (new Date(Date.now() + (storage.expires * (60 * 60 * 24 * 1000)))).toUTCString();

      if (config.storage.type === COOKIE) {
        if (storage.cookiesAreEnabled()) {
          storage.setCookie(key, value, expiresStr, 'LAX', COOKIE_DOMAIN);
        }
      } else if (config.storage.type === LOCAL_STORAGE) {
        if (storage.hasLocalStorage()) {
          storage.setDataInLocalStorage(`${key}_exp`, expiresStr);
          storage.setDataInLocalStorage(key, value);
        }
      }
    }
  } catch (error) {
    utils.logError(error);
  }
}

/**
 * Read sharedid from cookie or local storage
 * @param config Need config.storage to derive key and storage type
 * @return {string}
 */
function readData(config) {
  try {
    const key = config.storage.name + SHAREDID_SUFFIX;
    if (config.storage.type === COOKIE) {
      if (storage.cookiesAreEnabled()) {
        return storage.getCookie(key);
      }
    } else if (config.storage.type === LOCAL_STORAGE) {
      if (storage.hasLocalStorage()) {
        const expValue = storage.getDataFromLocalStorage(`${key}_exp`);
        if (!expValue) {
          return storage.getDataFromLocalStorage(key);
        } else if ((new Date(expValue)).getTime() - Date.now() > 0) {
          return storage.getDataFromLocalStorage(key)
        }
      }
    }
  } catch (error) {
    utils.logError(error);
  }
}

/**
 * Delete sharedid from cookie or local storage
 * @param config Need config.storage to derive key and storage type
 */
function delData(config) {
  try {
    const key = config.storage.name + SHAREDID_SUFFIX;
    if (config.storage.type === COOKIE) {
      if (storage.cookiesAreEnabled()) {
        storage.setCookie(key, '', EXPIRED_COOKIE_DATE);
      }
    } else if (config.storage.type === LOCAL_STORAGE) {
      storage.removeDataFromLocalStorage(`${key}_exp`);
      storage.removeDataFromLocalStorage(key);
    }
  } catch (error) {
    utils.logError(error);
  }
}

/**
 * setup success and error handler for sharedid callback thru ajax
 * @param {string} pubcid Current pubcommon id
 * @param {function} callback userId module callback.
 * @param {Object} config Need config.storage to derive sharedid storage params
 * @return {{success: success, error: error}}
 */

function handleResponse(pubcid, callback, config) {
  return {
    success: function (responseBody) {
      if (responseBody) {
        try {
          let responseObj = JSON.parse(responseBody);
          utils.logInfo('PubCommonId: Generated SharedId: ' + responseObj.sharedId);
          if (responseObj.sharedId) {
            if (responseObj.sharedId !== SHAREDID_OPT_OUT_VALUE) {
              // Store sharedId locally
              storeData(config, responseObj.sharedId);
            } else {
              // Delete local copy if the user has opted out
              delData(config);
            }
          }
          // Pass pubcid even though there is no change in order to trigger decode
          callback(pubcid);
        } catch (error) {
          utils.logError(error);
        }
      }
    },
    error: function (statusText, responseBody) {
      utils.logInfo('PubCommonId: failed to get sharedid');
    }
  }
}

/**
 * Wraps pixelCallback in order to call sharedid sync
 * @param {string} pubcid Pubcommon id value
 * @param {function|undefined} pixelCallback fires a pixel to first party server
 * @param {Object} config Need config.storage to derive sharedid storage params.
 * @return {function(...[*]=)}
 */

function getIdCallback(pubcid, pixelCallback, config) {
  return function (callback) {
    if (typeof pixelCallback === 'function') {
      pixelCallback();
    }
    ajax(SHAREDID_URL, handleResponse(pubcid, callback, config), undefined, {method: 'GET', withCredentials: true});
  }
}

/** @type {Submodule} */
export const pubCommonIdSubmodule = {
  /**
   * used to link submodule with config
   * @type {string}
   */
  name: MODULE_NAME,

  /**
   * Return a callback function that calls the pixelUrl with id as a query parameter
   * @param pixelUrl
   * @param id
   * @returns {function}
   */
  makeCallback: function (pixelUrl, id = '') {
    if (!pixelUrl) {
      return;
    }

    // Use pubcid as a cache buster
    const urlInfo = utils.parseUrl(pixelUrl);
    urlInfo.search.id = encodeURIComponent('pubcid:' + id);
    const targetUrl = utils.buildUrl(urlInfo);

    return function () {
      utils.triggerPixel(targetUrl);
    };
  },
  /**
   * decode the stored id value for passing to bid requests
   * @function
   * @param {string} value
   * @param {SubmoduleConfig} config
   * @returns {{pubcid:string}}
   */
  decode(value, config) {
    const idObj = {'pubcid': value};
    const {params: {enableSharedId = SHAREDID_DEFAULT_STATE} = {}} = config;

    if (enableSharedId) {
      const sharedId = readData(config);
      if (sharedId) idObj['sharedid'] = {id: sharedId};
    }

    return idObj;
  },
  /**
   * performs action to obtain id
   * @function
   * @param {SubmoduleConfig} [config] Config object with params and storage properties
   * @param {Object} consentData
   * @param {string} storedId Existing pubcommon id
   * @returns {IdResponse}
   */
  getId: function (config = {}, consentData, storedId) {
    const {params: {create = true, pixelUrl, enableSharedId = SHAREDID_DEFAULT_STATE} = {}} = config;
    let newId = storedId;
    if (!newId) {
      try {
        if (typeof window[PUB_COMMON_ID] === 'object') {
          // If the page includes its own pubcid module, then save a copy of id.
          newId = window[PUB_COMMON_ID].getId();
        }
      } catch (e) {
      }

      if (!newId) newId = (create && utils.hasDeviceAccess()) ? utils.generateUUID() : undefined;
    }

    const pixelCallback = this.makeCallback(pixelUrl, newId);
    const combinedCallback = enableSharedId ? getIdCallback(newId, pixelCallback, config) : pixelCallback;

    return {id: newId, callback: combinedCallback};
  },
  /**
   * performs action to extend an id.  There are generally two ways to extend the expiration time
   * of stored id: using pixelUrl or return the id and let main user id module write it again with
   * the new expiration time.
   *
   * PixelUrl, if defined, should point back to a first party domain endpoint.  On the server
   * side, there is either a plugin, or customized logic to read and write back the pubcid cookie.
   * The extendId function itself should return only the callback, and not the id itself to avoid
   * having the script-side overwriting server-side.  This applies to both pubcid and sharedid.
   *
   * On the other hand, if there is no pixelUrl, then the extendId should return storedId so that
   * its expiration time is updated.  Sharedid, however, will have to be updated by this submodule
   * separately.
   *
   * @function
   * @param {SubmoduleParams} [config]
   * @param {Object} storedId existing id
   * @returns {IdResponse|undefined}
   */
  extendId: function(config = {}, storedId) {
    const {params: {extend = false, pixelUrl, enableSharedId = SHAREDID_DEFAULT_STATE} = {}} = config;

    if (extend) {
      try {
        if (typeof window[PUB_COMMON_ID] === 'object') {
          if (enableSharedId) {
            // If the page includes its own pubcid module, then there is nothing to do
            // except to update sharedid's expiration time
            storeData(config, readData(config));
          }
          return;
        }
      } catch (e) {
      }

      if (pixelUrl) {
        const callback = this.makeCallback(pixelUrl, storedId);
        return {callback: callback};
      } else {
        if (enableSharedId) {
          // Update with the same value to extend expiration time
          storeData(config, readData(config));
        }
        return {id: storedId};
      }
    }
  },

  /**
   * @param {string} domain
   * @param {HTMLDocument} document
   * @return {(string|undefined)}
   */
  domainOverride: function () {
    const domainElements = document.domain.split('.');
    const cookieName = `_gd${Date.now()}`;
    for (let i = 0, topDomain; i < domainElements.length; i++) {
      const nextDomain = domainElements.slice(i).join('.');

      // write test cookie
      storage.setCookie(cookieName, '1', undefined, undefined, nextDomain);

      // read test cookie to verify domain was valid
      if (storage.getCookie(cookieName) === '1') {
        // delete test cookie
        storage.setCookie(cookieName, '', 'Thu, 01 Jan 1970 00:00:01 GMT', undefined, nextDomain);
        // cookie was written successfully using test domain so the topDomain is updated
        topDomain = nextDomain;
      } else {
        // cookie failed to write using test domain so exit by returning the topDomain
        return topDomain;
      }
    }
  }
};

const COOKIE_DOMAIN = pubCommonIdSubmodule.domainOverride();

submodule('userId', pubCommonIdSubmodule);
