/*global Thrift*/

import MapDClientV2 from './mapd-client-v2'
import processQueryResults from './process-query-results'
import * as helpers from './helpers'
/**
 * The MapdCon class provides the necessary methods for performing queries to a
 * MapD GPU database. In order to use MapdCon, you must have the Thrift library
 * loaded into the <code>window</code> object first.
 */
class MapdCon {

  /**
   * Create a new MapdCon and return it to allow method chaining.
   * @return {MapdCon} Object
   *
   * @example <caption>Create a new MapdCon instance:</caption>
   * var con = new MapdCon();
   *
   * @example <caption>Create a new MapdCon instance and set the host via method chaining:</caption>
   * var con = new MapdCon().host('http://hostname.com');
   */
  constructor() {
    this._host = null;
    this._user = null;
    this._password = null;
    this._port = null;
    this._dbName = null;
    this._client = null;
    this._sessionId = null;
    this._protocol = null;
    this._datumEnum = {};
    this._logging = false;
    this._platform = 'mapd';
    this._nonce = 0;
    this._balanceStrategy = 'adaptive';
    this._numConnections = 0;
    this._lastRenderCon = 0;
    this.queryTimes = { };
    this.serverQueueTimes = null;
    this.serverPingTimes = null;
    this.pingCount = null;
    this.DEFAULT_QUERY_TIME = 50;
    this.NUM_PINGS_PER_SERVER = 4;
    this.importerRowDesc = null;

    // invoke initialization methods
    this.invertDatumTypes();

    /** Deprecated */
    this.queryAsync = this.query;

    this.processResults = (options, result, callback) => {
      const processor = processQueryResults(this._logging, this.updateQueryTimes)
      return processor(options, this._datumEnum, result, callback)
    }

    // return this to allow chaining off of instantiation
    return this;
  }

  /**
   * Create a connection to the server, generating a client and session id.
   * @return {MapdCon} Object
   *
   * @example <caption>Connect to a MapD server:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect();
   * // con.client() instanceof MapDClient === true
   * // con.sessionId() === 2070686863
   */
  connect(callback) {
    if (this._sessionId) {
      this.disconnect();
    }

    // TODO: should be its own function
    const allAreArrays = Array.isArray(this._host) &&
      Array.isArray(this._port) &&
      Array.isArray(this._user) &&
      Array.isArray(this._password) &&
      Array.isArray(this._dbName);
    if (!allAreArrays) {
      return callback('All connection parameters must be arrays.');
    }

    this._client = [];
    this._sessionId = [];

    // TODO:
    if (!this._user[0]) {
      return callback(`Please enter a username.`);
    } else if (!this._password[0]) {
      return callback(`Please enter a password.`);
    } else if (!this._dbName[0]) {
      return callback(`Please enter a database.`);
    } else if (!this._host[0]) {
      return callback(`Please enter a host name.`);
    } else if (!this._port[0]) {
      return callback(`Please enter a port.`);
    }

    // now check to see if length of all arrays are the same and > 0
    const hostLength = this._host.length;
    if (hostLength < 1) {
      return callback('Must have at least one server to connect to.');
    }
    if (hostLength !== this._port.length ||
        hostLength !== this._user.length ||
        hostLength !== this._password.length ||
        hostLength !== this._dbName.length) {
      return callback('Array connection parameters must be of equal length.');
    }

    if (!this._protocol) {
      this._protocol = this._host.map((host, i) => {
        return window.location.protocol.replace(':', '');
      });
    }

    const transportUrls = this.getEndpoints();
    for (let h = 0; h < hostLength; h++) {
      const transport = new Thrift.Transport(transportUrls[h]);
      const protocol = new Thrift.Protocol(transport);
      const client = new MapDClientV2(protocol);
      client.connect(this._user[h], this._password[h], this._dbName[h], (error, sessionId) => {
        if (error) {
          callback(error)
          return
        }
        this._client.push(client);
        this._sessionId.push(sessionId);
        this._numConnections = this._client.length;
        callback(null, this)
      });
    }

    return this;
  }

  convertFromThriftTypes(fields) {
    const fieldsArray = [];
    // silly to change this from map to array
    // - then later it turns back to map
    for (const key in fields) {
      if (fields.hasOwnProperty(key)) {
        fieldsArray.push({
          name: key,
          type: this._datumEnum[fields[key].col_type.type],
          is_array: fields[key].col_type.is_array,
          is_dict: fields[key].col_type.encoding === TEncodingType.DICT,
        });
      }
    }
    return fieldsArray
  }

  /**
   * Disconnect from the server then clears the client and session values.
   * @return {MapdCon} Object
   *
   * @example <caption>Disconnect from the server:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect(); // Create a connection
   *
   * con.disconnect();
   * // con.client() === null;
   * // con.sessionId() === null;
   */
  disconnect(callback) {
    if (this._sessionId !== null) {
      for (let c = 0; c < this._client.length; c++) {
        this._client[c].disconnect(this._sessionId[c], (error, success) => {
          // Success will return NULL

          if (error) {
            return callback(error)
          }
          this._sessionId = null;
          this._client = null;
          this._numConnections = 0;
          this.serverPingTimes = null;
          return callback()
        });
      }
    }
    return this;
  }

  /**
   * TODO
   */
  pingServers(callback) {
    if (this._sessionId !== null) {
      this.serverPingTimes = Array.apply(
        null,
        Array(this._numConnections)
      ).map(Number.prototype.valueOf, 0);
      this.pingCount = 0;
      for (let c = 0; c < this._numConnections; c++) {
        for (let i = 0; i < this.NUM_PINGS_PER_SERVER; i++) {
          const startTime = new Date();
          this._client[c].get_server_status(
            this._sessionId[c],
            this.pingServersCallback.bind(this, startTime, c, callback)
          );
        }
      }
    }
  }

  /**
   * TODO
   */
  pingServersCallback(startTime, serverNum, callback) {
    const now = new Date();
    const duration = now - startTime;
    this.serverPingTimes[serverNum] += duration;
    this.pingCount++;
    if (this.pingCount === this._numConnections * this.NUM_PINGS_PER_SERVER) {
      this.pingCount = 0;
      for (let c = 0; c < this._numConnections; c++) {
        this.serverPingTimes[c] /= this.NUM_PINGS_PER_SERVER;
        // handicap each server based on its ping time
        // - this should be persistent as we never zero our times
        this.serverQueueTimes[c] += this.serverPingTimes[c];
      }

      if (typeof callback !== 'undefined') {
        callback(this, this.serverQueueTimes);
      }
    }
  }

  /**
   * TODO
   */
  balanceStrategy(balanceStrategy) {
    if (!arguments.length) {
      return this._balanceStrategy;
    }
    this._balanceStrategy = balanceStrategy;
    return this;
  }

  updateQueryTimes = (conId, queryId, estimatedQueryTime, execution_time_ms) => {
    this.queryTimes[queryId] = execution_time_ms;
  }

  /**
   * Get the recent dashboards as a list of <code>TFrontendView</code> objects.
   * These objects contain a value for the <code>view_name</code> property,
   * but not for the <code>view_state</code> property.
   * @return {Array<TFrontendView>}
   *
   * @example <caption>Get the list of dashboards from the server:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect(); // Create a connection
   *
   * var views = con.getFrontendViews();
   * // views === [TFrontendView, TFrontendView]
   */
  getFrontendViews = (callback) => {
    if (this._sessionId) {
      this._client[0].get_frontend_views(this._sessionId, (error, views) => {
        if (error) {
          callback(error)
        } else {
          callback(null, views)
        }
      });
    } else {
      callback(new Error('No Session ID'))
    }
  }

  getFrontendViewsAsync = () => (
    new Promise((resolve, reject) => {
      this.getFrontendViews((error, views) => {
        if (error) {
          reject(error)
        } else {
          resolve(views)
        }
      })
    })
  )

  /**
   * Get a dashboard object containing a value for the <code>view_state</code> property.
   * This object contains a value for the <code>view_state</code> property,
   * but not for the <code>view_name</code> property.
   * @param {String} viewName - the name of the dashboard
   * @return {TFrontendView} Object
   *
   * @example <caption>Get a specific dashboard from the server:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect(); // Create a connection
   *
   * var dashboard = con.getFrontendView();
   * // dashboard instanceof TFrontendView === true
   */
  getFrontendView = (viewName, callback) => {
    if (this._sessionId && viewName) {
      this._client[0].get_frontend_view(this._sessionId, viewName, (error, view) => {
        if (error) {
          callback(error)
        } else {
          callback(null, view)
        }
      });
    } else {
      callback(new Error('No Session ID'))
    }
  }

  getFrontendViewAsync = (viewName) => new Promise((resolve, reject) => {
    this.getFrontendView(viewName, (err, view) => {
      if (err) {
        reject(err)
      } else {
        resolve(view)
      }
    })
  })

  /**
   * Get the status of the server as a <code>TServerStatus</code> object.
   * This includes whether the server is read-only,
   * has backend rendering enabled, and the version number.
   * @return {TServerStatus} Object
   *
   * @example <caption>Get the server status:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect(); // Create a connection
   *
   * var status = con.getServerStatus();
   * // status instanceof TServerStatus === true
   *
   */
   getServerStatus = (callback) => {
     this._client[0].get_server_status(null, (result) => {
       if (typeof result === 'object' &&
           result.hasOwnProperty('read_only') &&
           result.hasOwnProperty('rendering_enabled') &&
           result.hasOwnProperty('version')) {
         callback(null, result)
       } else {
         callback(result, null)
       }
     });
   }

   getServerStatusAsync = () => (
     new Promise((resolve, reject) => {
       this.getServerStatus((err, result) => {
         if (err) {
           reject(err)
         } else {
           resolve(result)
         }
       })
     })
   )

  /**
   * Generate the image thumbnail hash used for saving frontend view.
   * @param {String} input - The string input to hash
   * @return {Number} hash - Numerical hash used for saving dashboards
   *
   * @example <caption>Generate an hash</caption>
   * var hash = generateImageThumbnailHashCode(Math.random().toString());
   * // hash === 3003444
   */
  generateImageThumbnailHashCode(input) {
    return input.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
  }

  /**
   * Generate the state string used for saving frontend view.
   * @param {Object} state - The object containing the state
   * @param {Boolean} encode=false - Indicates whether to base64 encode the output string
   * @return {String} stateString - The string representation of the state object
   *
   * @example <caption>Generate a raw state string:</caption>
   * var state = generateViewStateString({id: 5});
   * // state === ''
   *
   * @example <caption>Generate an encoded state string:</caption>
   * var state = generateViewStateString({id: 5}, true);
   * // state === ''
   */
  generateViewStateString(state, encode) {
    // TODO
  }

  /**
   * Add a new dashboard to the server.
   * @param {String} viewName - the name of the new dashboard
   * @param {String} viewState - the base64-encoded state string of the new dashboard
   * @param {String} imageHash - the numeric hash of the dashboard thumbnail
   * @param {String} metaData - Stringified metaData related to the view
   * @return {MapdCon} Object
   *
   * @example <caption>Add a new dashboard to the server:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect();
   *
   * con.createFrontendView('newView', 'GlnaHRz...', '1906667617');
   */
  createFrontendView(viewName, viewState, imageHash, metaData) {
    if (!this._sessionId) {
      throw new Error('You are not connected to a server. Try running the connect method first.');
    }
    try {
      // do we want to try each one individually so if we fail we keep going?
      this._client.forEach((client, i) => {
        client.create_frontend_view(this._sessionId[i], viewName, viewState, imageHash, metaData);
      });
    } catch (err) {
      throw err;
    }
    return this;
  }

  createFrontendViewAsync = (viewName, viewState, imageHash, metaData) => {
    if (!this._sessionId) {
      return new Promise((resolve, reject) => {
        reject(new Error('You are not connected to a server. Try running the connect method first.'))
      })
    }

    return Promise.all(this._client.map((client, i) => {
      return new Promise((resolve, reject) => {
        client.create_frontend_view(this._sessionId[i], viewName, viewState, imageHash, metaData, (error, data) => {
          if (error) {
            reject(error)
          } else {
            resolve(data)
          }
        })
      })
    }))
  }

  /**
   * Delete a dashboard object containing a value for the <code>view_state</code> property.
   * @param {String} viewName - the name of the dashboard
   * @param {Function} callback
   * @return {TFrontendView} Object
   *
   * @example <caption>Delete a specific dashboard from the server:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect(); // Create a connection
   *
   * con.deleteFrontendView(viewName);
   */
  deleteFrontendView = (viewName, callback) => {
    if (!this._sessionId) {
      throw new Error('You are not connected to a server. Try running the connect method first.');
    }
    try {
      this._client.forEach((client, i) => {
        // do we want to try each one individually so if we fail we keep going?
        client.delete_frontend_view(this._sessionId[i], viewName, callback);
      });
    } catch (err) {
      console.log('ERROR: Could not delete the frontend view. Check your session id.', err);
    }
  }

  deleteFrontendViewAsync = (viewName) => {
    return new Promise((resolve, reject) => {
      this.deleteFrontendView(viewName, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve(viewName)
        }
      })
    })
  }

  /**
   * Create a short hash to make it easy to share a link to a specific dashboard.
   * @param {String} viewState - the base64-encoded state string of the new dashboard
   * @param {String} metaData - Stringified metaData related to the link
   * @return {String} link - A short hash of the dashboard used for URLs
   *
   * @example <caption>Create a link to the current state of a dashboard:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect();
   *
   * // get a dashboard
   * var dashboards = con.getFrontendViews();
   * var dashboard = con.getFrontendView(dashboards[0].view_name);
   *
   * var link = con.createLink(dashboard.view_state);
   * // link === 'CRtzoe'
   */
  createLinkAsync (viewState, metaData) {
    return Promise.all(this._client.map((client, i) => {
      return new Promise((resolve, reject) => {
        client.create_link(this._sessionId[i], viewState, metaData, (error, data) => {
          if (error) {
            reject(error)
          } else {
            const result = data.split(',').reduce((links, link) => {
              if (links.indexOf(link) === -1) links.push(link);
              return links;
            }, []);
            if (!result || result.length !== 1) {
              reject(new Error('Different links were created on connection'));
            } else {
              resolve(result.join());
            }
          }
        })
      })
    }))
  }

  /**
   * Get a fully-formed dashboard object from a generated share link.
   * This object contains the given link for the <code>view_name</code> property,
   * @param {String} link - the short hash of the dashboard, see {@link createLink}
   * @return {TFrontendView} Object
   *
   * @example <caption>Get a dashboard from a link:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect();
   *
   * var dashboard = con.getLinkView('CRtzoe');
   * // dashboard instanceof TFrontendView === true
   */
  getLinkView = (link, callback) => {
    this._client[0].get_link_view(this._sessionId[0], link, (link) => {
      callback(null, link)
    });
  }

  getLinkViewAsync = (link) => new Promise((resolve, reject) => {
    this.getLinkView(link, (err, link) => {
      if (err) {
        reject(err)
      } else {
        resolve(link)
      }
    })
  })

  /**
   * Asynchronously get the data from an importable file,
   * such as a .csv or plaintext file with a header.
   * @param {String} fileName - the name of the importable file
   * @param {TCopyParams} copyParams - see {@link TCopyParams}
   * @param {Function} callback - specify a callback that takes a
   *                              {@link TDetectResult} as its only argument
   *
   * @example <caption>Get data from table_data.csv:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect();
   *
   * var copyParams = new TCopyParams();
   * con.detectColumnTypes('table_data.csv', copyParams, function(tableData){
   *   var columnHeaders = tableData.row_set.row_desc;
   *   // columnHeaders === [TColumnType, TColumnType, ...]
   *
   *   var data = tableData.row_set.rows;
   *   ...
   * });
   */
  detectColumnTypes(fileName, copyParams, callback) {
    const thriftCopyParams = helpers.convertObjectToThriftCopyParams(copyParams)
      this._client[0].detect_column_types(this._sessionId[0], fileName, thriftCopyParams, (err, res) => {
        if (err) {
          callback(err)
        } else {
          callback(null, res)
        }
      });
  }

  detectColumnTypesAsync(fileName, copyParams) {
    return new Promise((resolve, reject) => {
      this.detectColumnTypes.bind(this, fileName, copyParams)((err, res) => {
        if (err) {
          reject(err)
        } else {
          this.importerRowDesc = res.row_set.row_desc;
          resolve(res)
        }
      })
    })
  }

  /**
   * Submit a query to the database and process the results through an array
   * of asychronous callbacks. If no callbacks are given, use synchronous instead.
   * TODO: Refactor to use take a query and an options object
   * @param {String} query - The query to perform
   * @param {Object} options - the options for the query
   * @param {Boolean} options.columnarResults=true - Indicates whether to return the data
   *                                             in columnar format. This saves time on the backend.
   * @param {Boolean} options.eliminateNullRows
   * @param {String} options.renderSpec - The backend rendering spec,
   *                                      set to <code>null</code> to force frontend rendering
   * @param {Array<Function>} callbacks
   */
  query(query, options, callback) {
    let columnarResults = true;
    let eliminateNullRows = false;
    let renderSpec = null;
    let queryId = null;
    let limit = -1
    if (options) {
      columnarResults = options.hasOwnProperty('columnarResults') ?
        options.columnarResults : columnarResults;
      eliminateNullRows = options.hasOwnProperty('eliminateNullRows') ?
        options.eliminateNullRows : eliminateNullRows;
      renderSpec = options.hasOwnProperty('renderSpec') ?
        options.renderSpec : renderSpec;
      queryId = options.hasOwnProperty('queryId') ?
        options.queryId : queryId;
      limit = options.hasOwnProperty('limit') ?
        options.limit : limit;
    }
    const processResultsQuery = renderSpec ? 'render: ' + query : query;
    const isBackendRenderingWithAsync = !!renderSpec && !!callback;
    const isFrontendRenderingWithAsync = !renderSpec && !!callback;
    const isBackendRenderingWithSync = !!renderSpec && !callback;
    const isFrontendRenderingWithSync = !renderSpec && !callback;
    const lastQueryTime = queryId in this.queryTimes
      ? this.queryTimes[queryId]
      : this.DEFAULT_QUERY_TIME;

    const curNonce = (this._nonce++).toString();

    let conId = 0
    if (!!renderSpec) {
      this._lastRenderCon = conId;
    }

    const processResultsOptions = {
      isImage: !!renderSpec,
      eliminateNullRows,
      query: processResultsQuery,
      queryId,
      conId,
      estimatedQueryTime: lastQueryTime,
    };

    try {
      if (isBackendRenderingWithAsync) {
        this._client[conId].render(this._sessionId[conId], query, renderSpec, curNonce, limit, (error, result) => {
          if (error) {
            callback(error)
          } else {
            this.processResults(processResultsOptions, result, callback)
          }
        });
        return curNonce;
      } else if (isFrontendRenderingWithAsync) {
        this._client[conId].sql_execute(this._sessionId[conId], query, columnarResults, curNonce, limit, (error, result) => {
          if (error) {
            callback(error)
          } else {
             this.processResults(processResultsOptions, result, callback)
          }
        });
        return curNonce;
      } else if (isBackendRenderingWithSync) {
        const renderResult = this._client[conId].render(
          this._sessionId[conId],
          query,
          renderSpec,
          curNonce,
          limit
        );
        return this.processResults(processResultsOptions, renderResult);
      } else if (isFrontendRenderingWithSync) {
        const SQLExecuteResult = this._client[conId].sql_execute(
          this._sessionId[conId],
          query,
          columnarResults,
          curNonc,
          limit
        );
        return this.processResults(processResultsOptions, SQLExecuteResult);
      }
    } catch (err) {
      if (err.name === 'NetworkError') {
        this.removeConnection(conId);
        if (this._numConnections === 0) {
          // should we try to reconnect?
          err.msg = 'No remaining database connections';
          throw err;
        }
        this.query(query, options, callback);
      } else if (callback) {
        callback(err)
      } else {
        throw err
      }
    }
  }


  validateQuery(query) {
    return new Promise((resolve, reject) => {
      this._client[0].sql_validate(this._sessionId[0], query, (err, res) => {
        if (err) {
          reject(err)
        } else {
          resolve(this.convertFromThriftTypes(res))
        }
      });
    })
  }
  /**
   * TODO
   */
  removeConnection(conId) {
    if (conId < 0 || conId >= this.numConnections) {
      const err = {
        msg: 'Remove connection id invalid',
      };
      throw err;
    }
    this._client.splice(conId, 1);
    this._sessionId.splice(conId, 1);
    this._numConnections--;
  }

  /**
   * Get the names of the databases that exist on the current session's connectdion.
   * @return {Array<String>} list of database names
   *
   * @example <caption>Create a new MapdCon instance and set the host via method chaining:</caption>
   * var databases = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect()
   *   .getDatabases();
   * // databases === ['databasename', 'databasename', ...]
   */
  getDatabases() {
    let databases = null;
    try {
      databases = this._client[0].get_databases();
      return databases.map((db) => { return db.db_name; });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get the names of the databases that exist on the current session's connectdion.
   * @return {Array<Object>} list of table objects containing the label and table names.
   *
   * @example <caption>Get the list of tables from a connection:</caption>
   * var tables = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect()
   *   .getTables();
   * // tables === [{
   *    label: 'obs', // deprecated property
   *    name: 'myDatabaseName'
   *  }, ...]
   */
  getTables (callback) {
    this._client[0].get_tables(this._sessionId[0], (error, tables) => {
      if (error) {
        callback(error)
      } else {
        callback(null, tables.map((table) => ({
          name: table,
          label: 'obs'
        })))
      }
    });
  }

  getTablesAsync () {
    return new Promise((resolve, reject) => {
      this.getTables.bind(this)((error, tables) => {
        if (error) {
          reject(error)
        } else {
          resolve(tables)
        }
      })
    })
  }

  /**
   * Create an array-like object from {@link TDatumType} by
   * flipping the string key and numerical value around.
   */
  invertDatumTypes() {
    for (const key in TDatumType) {
      if (TDatumType.hasOwnProperty(key)) {
        this._datumEnum[TDatumType[key]] = key;
      }
    }
  }

  /**
   * Get a list of field objects for a given table.
   * @param {String} tableName - name of table containing field names
   * @return {Array<Object>} fields - the formmatted list of field objects
   *
   * @example <caption>Get the list of fields from a specific table:</caption>
   * var tables = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect()
   *   .getTables();
   *
   * var fields = con.getFields(tables[0].name);
   * // fields === [{
   *   name: 'fieldName',
   *   type: 'BIGINT',
   *   is_array: false,
   *   is_dict: false
   * }, ...]
   */
  getFields(tableName, callback) {
    if (callback) {
      this._client[0].get_table_descriptor(this._sessionId[0], tableName, (fields) => {
        if (!fields) {
          callback(new Error('Table (' + tableName + ') not found'))
        } else {
          callback(null, this.convertFromThriftTypes(fields))
        }
      })
    } else {
      console.warn('WARNING: You are using a synchronous method getFields() that will be deprecated')
      let fields = null;
      try {
        fields = this._client[0].get_table_descriptor(this._sessionId[0], tableName);
      } catch (err) {
        throw new Error('Table (' + tableName + ') not found');
      }
      const fieldsArray = [];
      // silly to change this from map to array
      // - then later it turns back to map
      for (const key in fields) {
        if (fields.hasOwnProperty(key)) {
          fieldsArray.push({
            name: key,
            type: this._datumEnum[fields[key].col_type.type],
            is_array: fields[key].col_type.is_array,
            is_dict: fields[key].col_type.encoding === TEncodingType.DICT,
          });
        }
      }
      return fieldsArray;
    }
  }


  /**
   * Create a table and persist it to the backend.
   * @param {String} tableName - desired name of the new table
   * @param {Array<TColumnType>} rowDesc - fields of the new table
   * @param {Function} callback
   *
   * @example <caption>Create a new table:</caption>
   * var result = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect()
   *   .createTable('mynewtable', [TColumnType, TColumnType, ...], cb);
   */
  createTable(tableName, rowDescObj, tableType, callback) {
    if (!this._sessionId) {
      throw new Error('You are not connected to a server. Try running the connect method first.');
    }

    const thriftRowDesc = helpers.mutateThriftRowDesc(rowDescObj, this.importerRowDesc)

    for (let c = 0; c < this._numConnections; c++) {
      this._client[c].create_table(
        this._sessionId[c],
        tableName,
        thriftRowDesc,
        tableType,
        (err) => {
          if (err) {
            callback(err)
          } else {
            callback()
          }
        }
      );
    }

  }

  createTableAsync = (tableName, rowDescObj, tableType) => new Promise((resolve, reject) => {
    this.createTable(tableName, rowDescObj, tableType, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })

  /**
   * Import a table from a file.
   * @param {String} tableName - desired name of the new table
   * @param {String} fileName
   * @param {TCopyParams} copyParams - see {@link TCopyParams}
   * @param {Function} callback
   */
  importTable(tableName, fileName, copyParams, rowDescObj, isShapeFile, callback) {
    if (!this._sessionId) {
      throw new Error('You are not connected to a server. Try running the connect method first.');
    }

    const thriftCopyParams = helpers.convertObjectToThriftCopyParams(copyParams)
    const thriftRowDesc = helpers.mutateThriftRowDesc(rowDescObj, this.importerRowDesc)

    const thriftCallBack = (err, res) => {
        if (err) {
          callback(err)
        } else {
          callback(null, res)
        }
      }

    for (let c = 0; c < this._numConnections; c++) {
      if (isShapeFile) {
        this._client[c].import_geo_table(
          this._sessionId[c],
          tableName,
          fileName,
          thriftCopyParams,
          thriftRowDesc,
          thriftCallBack
        );
      } else {
        this._client[c].import_table(
          this._sessionId[c],
          tableName,
          fileName,
          thriftCopyParams,
          thriftCallBack
        );
      }
    }
  }

  importTableAsyncWrapper(isShapeFile) {
    return (tableName, fileName, copyParams, headers) => new Promise((resolve, reject) => {
      this.importTable(tableName, fileName, copyParams, headers, isShapeFile, (err, link) => {
        if (err) {
          reject(err)
        } else {
          resolve(link)
        }
      })
    })
  }

  importTableAsync = this.importTableAsyncWrapper(false)
  importTableGeoAsync = this.importTableAsyncWrapper(true)

  /**
   * Get the status of the table import operation.
   * @param {TCopyParams} importId
   * @param {Function} callback
   */
  importTableStatus(importId, callback) {
    try {
      this._client[0].import_table_status(this._sessionId[0], importId, callback);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Use for backend rendering. This method will fetch a PNG image
   * that is a render of the vega json object.
   *
   * @param {Number} widgetId - the widget id of the calling widget
   * @param {String} vega - the vega json
   * @param {Object} options - the options for the render query
   * @param {Number} options.compressionLevel - the png compression level.
   *                  range 1 (low compression, faster) to 10 (high compression, slower).
   *                  Default 3.
   * @param {Function} callback
   */

  renderVega (widgetid, vega, options, callback) /* istanbul ignore next */ {
    let queryId = null;
    let compressionLevel = 3;
    if (options) {
      queryId = options.hasOwnProperty('queryId') ?
        options.queryId : queryId;
      compressionLevel = options.hasOwnProperty('compressionLevel') ?
        options.compressionLevel : compressionLevel;
    }

    const lastQueryTime = queryId in this.queryTimes
      ? this.queryTimes[queryId]
      : this.DEFAULT_QUERY_TIME;

    const curNonce = (this._nonce++).toString();

    let conId = 0
    this._lastRenderCon = conId;

    const processResultsOptions = {
      isImage: true,
      query: 'render: ' + vega,
      queryId,
      conId,
      estimatedQueryTime: lastQueryTime,
    };

    try {
      if (!callback) {
        const renderResult = this._client[conId].render_vega(
          this._sessionId[conId],
          widgetid,
          vega,
          compressionLevel,
          curNonce
        );
        return this.processResults(processResultsOptions, renderResult);
      }

      this._client[conId].render_vega(this._sessionId[conId], widgetid, vega, compressionLevel, curNonce, (error, result) => {
        if (error) {
          callback(error)
        } else {
          this.processResults(processResultsOptions, result, callback)
        }
      });
    } catch (err) {
      throw err;
    }

    return curNonce;
  }

  /**
   * Used primarily for backend rendered maps, this method will fetch the rows
   * that correspond to longitude/latitude points.
   *
   * @param {Array<TPixel>} pixels
   * @param {String} tableName - the table containing the geo data
   * @param {Array<String>} colNames - the fields to fetch
   * @param {Array<Function>} callbacks
   */
  getRowsForPixels(pixels, tableName, colNames, callbacks) {
    const widgetId = 1;  // INT
    const columnFormat = true; // BOOL
    const curNonce = (this._nonce++).toString();
    try {
      if (!callbacks) {
        return this.processPixelResults(
          undefined,
          this._client[this._lastRenderCon].get_rows_for_pixels(
            this._sessionId[this._lastRenderCon],
            widgetId,
            pixels,
            tableName,
            colNames,
            columnFormat,
            curNonce
          ));
      }
      this._client[this._lastRenderCon].get_rows_for_pixels(
        this._sessionId[this._lastRenderCon],
        widgetId,
        pixels,
        tableName,
        colNames,
        columnFormat,
        curNonce,
        this.processPixelResults.bind(this, callbacks)
      );
    } catch (err) {
      throw err;
    }
    return curNonce;
  }

  /**
   * Used primarily for backend rendered maps, this method will fetch the row
   * that corresponds to longitude/latitude points.
   *
   * @param {TPixel} pixel
   * @param {String} tableName - the table containing the geo data
   * @param {Array<String>} colNames - the fields to fetch
   * @param {Array<Function>} callbacks
   * @param {Number} [pixelRadius=2] - the radius around the primary pixel to search
   */
  getRowForPixel(pixel, tableName, colNames, callbacks, pixelRadius = 2) {
    const widgetId = 1;  // INT
    const columnFormat = true; // BOOL
    const curNonce = (this._nonce++).toString();
    try {
      if (!callbacks) {
        return this.processResults(
          undefined,
          this._client[this._lastRenderCon].get_row_for_pixel(
            this._sessionId[this._lastRenderCon],
            widgetId,
            pixel,
            tableName,
            colNames,
            columnFormat,
            Math.round(pixelRadius),
            curNonce
          ));
      }
      this._client[this._lastRenderCon].get_row_for_pixel(
        this._sessionId[this._lastRenderCon],
        widgetId,
        pixel,
        tableName,
        colNames,
        columnFormat,
        Math.round(pixelRadius),
        curNonce,
        this.processPixelResults.bind(this, callbacks)
      );
    } catch (err) {
      throw err;
    }
    return curNonce;
  }

  /**
   * Used primarily for backend rendered maps, this method will fetch the row
   * for a specific table that was last rendered at a pixel.
   *
   * @param {widgetId} Number - the widget id of the caller
   * @param {TPixel} pixel - the pixel (lower left-hand corner is pixel (0,0))
   * @param {String} tableName - the table containing the geo data
   * @param {Object} tableColNamesMap - object of tableName -> array of col names
   * @param {Array<Function>} callbacks
   * @param {Number} [pixelRadius=2] - the radius around the primary pixel to search
   */

  getResultRowForPixel (widgetId, pixel, tableColNamesMap, callbacks, pixelRadius = 2) /* istanbul ignore next */ {
    const columnFormat = true; // BOOL
    const curNonce = (this._nonce++).toString();
    try {
      if (!callbacks) {
        return this.processPixelResults(
          undefined,
          this._client[this._lastRenderCon].get_result_row_for_pixel(
            this._sessionId[this._lastRenderCon],
            widgetId,
            pixel,
            tableColNamesMap,
            columnFormat,
            pixelRadius,
            curNonce
          ));
      }
      this._client[this._lastRenderCon].get_result_row_for_pixel(
        this._sessionId[this._lastRenderCon],
        widgetId,
        pixel,
        tableColNamesMap,
        columnFormat,
        pixelRadius,
        curNonce,
        this.processPixelResults.bind(this, callbacks)
      );
    } catch (err) {
      throw err;
    }
    return curNonce;
  }


  /**
   * Formats the pixel results into the same pattern as textual results.
   *
   * @param {Array<Function>} callbacks
   * @param {Object} results
   */
  processPixelResults(callbacks, results) {
    results = Array.isArray(results) ? results.pixel_rows : [results];
    const numPixels = results.length;
    const processResultsOptions = {
      isImage: false,
      eliminateNullRows: false,
      query: 'pixel request',
      queryId: -2,
    };
    for (let p = 0; p < numPixels; p++) {
      results[p].row_set = this.processResults(processResultsOptions, results[p]);
    }
    if (!callbacks) {
      return results;
    }
    callbacks.pop()(results, callbacks);
  }

  /**
   * TODO: Returns an empty String.
   */
  getUploadServer() {
    return '';
  }

  /**
   * Get or set the session ID used by the server to serve the correct data.
   * This is typically set by {@link connect} and should not be set manually.
   * @param {Number} [sessionId] - The session ID of the current connection
   * @return {Number|MapdCon} - The session ID or the MapdCon itself
   *
   * @example <caption>Get the session id:</caption>
   * var sessionID = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect()
   *   .sessionId();
   * // sessionID === 3145846410
   *
   * @example <caption>Set the session id:</caption>
   * var con = new MapdCon().connect().sessionId(3415846410);
   * // NOTE: It is generally unsafe to set the session id manually.
   */
  sessionId(sessionId) {
    if (!arguments.length) {
      return this._sessionId;
    }
    this._sessionId = sessionId;
    return this;
  }

  /**
   * Get or set the connection server hostname.
   * This is is typically the first method called after instantiating a new MapdCon.
   * @param {String} [host] - The hostname address
   * @return {String|MapdCon} - The hostname or the MapdCon itself
   *
   * @example <caption>Set the hostname:</caption>
   * var con = new MapdCon().host('localhost');
   *
   * @example <caption>Get the hostname:</caption>
   * var host = con.host();
   * // host === 'localhost'
   */
  host(host) {
    if (!arguments.length) {
      return this._host;
    } else if (!Array.isArray(host)) {
      this._host = [host];
    } else {
      this._host = host;
    }
    return this;
  }

  /**
   * Get or set the connection port.
   * @param {String} [port] - The port to connect on
   * @return {String|MapdCon} - The port or the MapdCon itself
   *
   * @example <caption>Set the port:</caption>
   * var con = new MapdCon().port('8080');
   *
   * @example <caption>Get the port:</caption>
   * var port = con.port();
   * // port === '8080'
   */
  port(port) {
    if (!arguments.length) {
      return this._port;
    } else if (!Array.isArray(port)) {
      this._port = [port];
    } else {
      this._port = port;
    }
    return this;
  }

  /**
   * Get or set the username to authenticate with.
   * @param {String} [user] - The username to authenticate with
   * @return {String|MapdCon} - The username or the MapdCon itself
   *
   * @example <caption>Set the username:</caption>
   * var con = new MapdCon().user('foo');
   *
   * @example <caption>Get the username:</caption>
   * var username = con.user();
   * // user === 'foo'
   */
  user(user) {
    if (!arguments.length) {
      return this._user;
    } else if (!Array.isArray(user)) {
      this._user = [user];
    } else {
      this._user = user;
    }
    return this;
  }

  /**
   * Get or set the user's password to authenticate with.
   * @param {String} [password] - The password to authenticate with
   * @return {String|MapdCon} - The password or the MapdCon itself
   *
   * @example <caption>Set the password:</caption>
   * var con = new MapdCon().password('bar');
   *
   * @example <caption>Get the username:</caption>
   * var password = con.password();
   * // password === 'bar'
   */
  password(password) {
    if (!arguments.length) {
      return this._password;
    } else if (!Array.isArray(password)) {
      this._password = [password];
    } else {
      this._password = password;
    }
    return this;
  }

  /**
   * Get or set the name of the database to connect to.
   * @param {String} [dbName] - The database to connect to
   * @return {String|MapdCon} - The name of the database or the MapdCon itself
   *
   * @example <caption>Set the database name:</caption>
   * var con = new MapdCon().dbName('myDatabase');
   *
   * @example <caption>Get the database name:</caption>
   * var dbName = con.dbName();
   * // dbName === 'myDatabase'
   */
  dbName(dbName) {
    if (!arguments.length) {
      return this._dbName;
    } else if (!Array.isArray(dbName)) {
      this._dbName = [dbName];
    } else {
      this._dbName = dbName;
    }
    return this;
  }

  /**
   * Whether the raw queries strings will be logged to the console.
   * Used primarily for debugging and defaults to <code>false</code>.
   * @param {Boolean} [logging] - Set to true to enable logging
   * @return {Boolean|MapdCon} - The current logging flag or MapdCon itself
   *
   * @example <caption>Set logging to true:</caption>
   * var con = new MapdCon().logging(true);
   *
   * @example <caption>Get the logging flag:</caption>
   * var isLogging = con.logging();
   * // isLogging === true
   */
  logging(logging) {
    if (typeof logging === "undefined") {
      return this._logging;
    } else if(typeof(logging) !== "boolean"){
      return 'logging can only be set with boolean values'
    }
    this._logging = logging;
    const isEnabledTxt = logging ? "enabled" : "disabled"
    return `SQL logging is now ${isEnabledTxt}`
  }

  /**
   * The name of the platform.
   * @param {String} [platform] - The platform, default is "mapd"
   * @return {String|MapdCon} - The platform or the MapdCon itself
   *
   * @example <caption>Set the platform name:</caption>
   * var con = new MapdCon().platform('myPlatform');
   *
   * @example <caption>Get the platform name:</caption>
   * var platform = con.platform();
   * // platform === 'myPlatform'
   */
  platform(platform) {
    if (!arguments.length) {
      return this._platform;
    }
    this._platform = platform;
    return this;
  }

  /**
   * Get the number of connections that are currently open.
   * @return {Number} - number of open connections
   *
   * @example <caption>Get the number of connections:</caption>
   * var con = new MapdCon()
   *   .host('localhost')
   *   .port('8080')
   *   .dbName('myDatabase')
   *   .user('foo')
   *   .password('bar')
   *   .connect();
   *
   * var numConnections = con.numConnections();
   * // numConnections === 1
   */
  numConnections() {
    return this._numConnections;
  }

  /**
   * The MapDClient instance to perform queries with.
   * @param {MapDClient} [client] - Thrift object used for communicating with the server
   * @return {MapDClient|MapdCon} - MapDClient or MapdCon itself
   *
   * @example <caption>Set the client:</caption>
   * var con = new MapdCon().client(client);
   * // NOTE: It is generally unsafe to set the client manually. Use connect() instead.
   *
   * @example <caption>Get the client:</caption>
   * var client = con.client();
   * // client instanceof MapDClient === true
   */
  client(client) {
    if (!arguments.length) {
      return this._client;
    }
    this._client = client;
    return this;
  }

  /**
   * The protocol to use for requests.
   * @param {String} [protocol] - http or https
   * @return {String|MapdCon} - protocol or MapdCon itself
   *
   * @example <caption>Set the protocol:</caption>
   * var con = new MapdCon().protocol('http');
   *
   * @example <caption>Get the protocol:</caption>
   * var protocol = con.protocol();
   * // protocol === 'http'
   */
  protocol(protocol) {
    if (!arguments.length) {
      return this._protocol;
    } else if (!Array.isArray(protocol)) {
      this._protocol = [protocol];
    } else {
      this._protocol = protocol;
    }
    return this;
  }

  /**
   * Generates a list of endpoints from the connection params.
   * @return {Array<String>} - list of endpoints
   *
   * @example <caption>Get the endpoints:</caption>
   * var con = new MapdCon().protocol('http').host('localhost').port('8000');
   * var endpoints = con.getEndpoints();
   * // endpoints === [ 'http://localhost:8000' ]
   */
  getEndpoints() {
    return this._host.map((host, i) => {
      return this._protocol[i] + '://' + host + ':' + this._port[i];
    });
  }
}

// Set a global mapdcon function when mapdcon is brought in via script tag.
if (typeof module === 'object' && module.exports) {
  if (window) {
    window.MapdCon = MapdCon;
  }
}

export default new MapdCon();
