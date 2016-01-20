/**
 * The MapdCon class provides the necessary methods for performing queries to a MapD GPU database.
 * In order to use MapdCon, you must have the Thrift library loaded into the <code>window</code> object first.
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
  constructor(){

    // Set up "private" variables and their defaults
    this._host = null;
    this._user = null;
    this._password = null;
    this._port = null;
    this._dbName = null;
    this._client = null;
    this._sessionId = null;
    this._datumEnum = {};
    this._logging = false;
    this._platform = "mapd";
    this._nonce = 0;
    this._balanceStrategy = "adaptive";
    this._numConnections = 0;
    this._lastRenderCon = 0;
    this.queryTimes = { };
    this.serverQueueTimes = [];
    this.DEFAULT_QUERY_TIME = 50;

    // invoke initialization methods
    this.invertDatumTypes();

    /** Deprecated */
    this.setHost = this.host;

    /** Deprecated */
    this.setPort = this.port;

    /** Deprecated */
    this.setDbName = this.dbName;

    /** Deprecated */
    this.setPlatform = this.platform;

    /** Deprecated */
    this.setUserAndPassword = (user, password) => {
      if (!Array.isArray(user))
        this._user = [user];
      else
        this._user = user;

      if (!Array.isArray(password))
        this._password = [password];
      else
        this._password = password;

      return this;
    }

    /** Deprecated */
    this.getPlatform = this.platform;

    /** Deprecated */
    this.getSessionId = this.sessionId;

    /** Deprecated */
    this.queryAsync = this.query;

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
  connect() {
    if(this._sessionId){
      this.disconnect();
    }
    let allAreArrays = Array.isArray(this._host) && Array.isArray(this._port) && Array.isArray(this._user) && Array.isArray(this._password) && Array.isArray(this._dbName);
    if (!allAreArrays)
            throw "All connection parameters must be arrays"; // should not throw now as we check parameter input and convert to arrays as needed 
    
    this._client = [];
    this._sessionId = [];

    // now check to see if length of all arrays are the same and > 0
    let hostLength = this._host.length;
    if (hostLength < 1)
            throw "Must have at least one server to connect to."; 
    if (hostLength !== this._port.length || hostLength !== this._user.length || hostLength !== this._password.length || hostLength !== this._dbName.length)
      throw "Array connection parameters must be of equal length.";

    for (var h = 0; h < hostLength; h++) {
      let transportUrl = "http://" + this._host[h] + ":" + this._port[h];
      try {
        let transport = new Thrift.Transport(transportUrl);
        let protocol = new Thrift.Protocol(transport);
        let client = new MapDClient(protocol);
        let sessionId = client.connect(this._user[h], this._password[h], this._dbName[h]);
        this._client.push(client);
        this._sessionId.push(sessionId);
      }
      catch (err) {
        console.error("Could not connect to " + this._host[h] + ":" + this._port[h]);
      }
    }
    this._numConnections = this._client.length;
    if (this._numConnections < 1) {  // need at least one server to connect to
      //clean up first
      this._client = null;
      this._sessionId = null;
      throw "Could not connect to any servers in list.";
    }
    this.serverQueueTimes = Array.apply(null, Array(this._numConnections)).map(Number.prototype.valueOf,0);

    return this;
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
  disconnect() {
    if (this._sessionId !== null) {
      for (var c = 0; c < this._client.length; c++) 
        this._client[c].disconnect(this._sessionId[c]);
      this._sessionId = null;
      this._client = null;
      this._numConnections = 0;
    }
    return this;
  }

  balanceStrategy(balanceStrategy) {
    if (!arguments.length)
            return this._balanceStrategy;
    this._balanceStrategy = balanceStrategy;
    return this;
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
  getFrontendViews() {
    var result = null;
    try {
      result = this._client[0].get_frontend_views(this._sessionId[0]);
    }
    catch(err) {
      console.log('ERROR: Could not get frontend views from backend. Check the session id.', err);
    }
    return result;
  }

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
  getFrontendView(viewName) {
    var result = null;
    try {
      result = this._client[0].get_frontend_view(this._sessionId[0], viewName);
    }
    catch(err) {
      console.log('ERROR: Could not get frontend view', viewName, 'from backend.', err);
    }
    return result;
  }

  /**
   * Get the status of the server as a <code>TServerStatus</code> object.
   * This includes whether the server is read-only, has backend rendering enabled, and the version number.
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
  getServerStatus() {
    var result = null;
    try {
      result = this._client[0].get_server_status();
    }
    catch(err) {
      console.log('ERROR: Could not get the server status. Check your connection and session id.', err);
    }
    return result;
  }

  /**
   * Add a new dashboard to the server.
   * @param {String} viewName - the name of the new dashboard
   * @param {String} viewState - the base64-encoded state string of the new dashboard
   * @param {String} imageHash - the numeric hash of the dashboard thumbnail 
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
  createFrontendView(viewName, viewState, imageHash) {
    try {
      for (var c = 0; c < this._numConnections; c++) // do we want to try each one individually so if we fail we keep going?
        this._client[c].create_frontend_view(this._sessionId[c], viewName, viewState, imageHash);
    }
    catch(err) {
      console.log('ERROR: Could not create the new frontend view. Check your session id.', err);
    }
    return this;
  }

  /**
   * Create a short hash to make it easy to share a link to a specific dashboard.
   * @param {String} viewState - the base64-encoded state string of the new dashboard
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
  createLink(viewState) {
    var result = null;
    try {
      result = this._client.create_link(this._sessionId, viewState);
    }
    catch(err) {
      console.log(err);
    }
    return result;
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
  getLinkView(link) {
    var result = null;
    try {
      result = this._client[0].get_link_view(this._sessionId[0], link);
    }
    catch(err) {
      console.log(err);
    }
    return result;
  }

  /**
   * Asynchronously get the data from an importable file, such as a .csv or plaintext file with a header.
   * @param {String} fileName - the name of the importable file 
   * @param {TCopyParams} copyParams - see {@link TCopyParams}
   * @param {Function} callback - specify a callback that takes a {@link TDetectResult} as its only argument 
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
    copyParams.delimiter = copyParams.delimiter || "";
    try {
      this._client[0].detect_column_types(this._sessionId[0], fileName, copyParams, callback);
    }
    catch(err) {
      console.log(err);
    }
  }

  /**
   * Submit a query to the database and process the results through an array of asychronous callbacks.
   * If no callbacks are given, use synchronous instead.
   * TODO: Refactor to use take a query and an options object
   * @param {String} query - The query to perform
   * @param {Boolean} columnarResults=true - Indicates whether to return the data in columnar format. This saves time on the backend.
   * @param {Boolean} eliminateNullRows - Indicates whether rows 
   * @param {String} renderSpec - The backend rendering spec, set to <code>undefined</code> to force frontend rendering
   * @param {Array<Function>} callbacks
   */
  query(query, options, callbacks) {

    let columnarResults = true;
    let eliminateNullRows = false;
    let renderSpec = null;
    let queryId = null;
    if (options) {
      columnarResults = options.columnarResults ? options.columnarResults : true; // make columnar results default if not specified
      eliminateNullRows = options.eliminateNullRows ? options.columnarResults : false;
      renderSpec = options.renderSpec ? options.renderSpec : undefined;
      queryId = options.queryId ? options.queryId : null;
    }
    let processResultsQuery = renderSpec ? 'render: ' + query : query; // format query for backend rendering if specified
    let isBackendRenderingWithAsync = !!renderSpec && !!callbacks;
    let isFrontendRenderingWithAsync = !renderSpec && !!callbacks;
    let isBackendRenderingWithSync = !!renderSpec && !callbacks;
    let isFrontendRenderingWithSync = !renderSpec && !callbacks;
    let lastQueryTime = queryId in this.queryTimes ? this.queryTimes[queryId] : this.DEFAULT_QUERY_TIME;
    
    let curNonce = (this._nonce++).toString();

    var conId = null;
    if (this._balanceStrategy === "adaptive") {
            conId = this.serverQueueTimes.indexOf(Math.min.apply(Math, this.serverQueueTimes));
    }
    else {
            conId = curNonce % this._numConnections;
    }
    if (!!renderSpec)
            this._lastRenderCon = conId;

    this.serverQueueTimes[conId] += lastQueryTime;

    let processResultsOptions = {
      isImage: !!renderSpec,
      eliminateNullRows: eliminateNullRows,
      query: processResultsQuery,
      queryId: queryId,
      conId: conId,
      estimatedQueryTime: lastQueryTime
    };

    let processResults = null;
    try {
      if (isBackendRenderingWithAsync) {
        processResults = this.processResults.bind(this, processResultsOptions, callbacks);
        this._client[conId].render(this._sessionId[conId], query + ";", renderSpec, {}, {}, curNonce, processResults);
        return curNonce;
      }
      if(isFrontendRenderingWithAsync) {
        processResults = this.processResults.bind(this, processResultsOptions, callbacks);
        this._client[conId].sql_execute(this._sessionId[conId], query + ";", columnarResults, curNonce, processResults);
        return curNonce;
      }
      if (isBackendRenderingWithSync) {
        return this.processResults(processResultsOptions, null, this._client[conId].render(this._sessionId[conId], query + ";", renderSpec, {}, {}, curNonce));
      }
      if (isFrontendRenderingWithSync) {
        var _result = this._client[conId].sql_execute(this._sessionId[conId], query + ";", columnarResults, curNonce);
        return this.processResults(processResultsOptions, null, _result); // null is callbacks slot
      }
    }
    catch(err) {
      console.error(err);
      if (err.name == "NetworkError" || err.name == "TMapDException") {
        this.removeConnection(conId);
        if (this._numConnections == 0) 
                throw "No remaining database connections";
        this.query(query, options, callbacks);
            
      }
    }
  }

  removeConnection(conId) {
    if (conId < 0 || conId >= this.numConnections) 
            throw "Remove connection id invalid"
    this._client.splice(conId, 1);
    this._sessionId.splice(conId, 1);
    this._numConnections--;
  }


  /**
   * Because it is inefficient for the server to return a row-based
   * data structure, it is better to process the column-based results into a row-based
   * format after the fact.
   *
   * @param {TRowSet} data - The column-based data returned from a query
   * @param {Boolean} eliminateNullRows
   * @returns {Object} processedResults 
   */
  processColumnarResults(data, eliminateNullRows) {

    var formattedResult = {fields: [], results: []};
    var numCols = data.row_desc.length;
    var numRows = data.columns[0] !== undefined ? data.columns[0].nulls.length : 0;

    formattedResult.fields = data.row_desc.map((field, i) => {
      return {
        "name": field.col_name,
        "type": this._datumEnum[field.col_type.type],
        "is_array": field.col_type.is_array
      };
    });

    for (var r = 0; r < numRows; r++) {
      if (eliminateNullRows) {
        var rowHasNull = false;
        for (var c = 0; c < numCols; c++) {
          if (data.columns[c].nulls[r]) {
            rowHasNull = true;
            break;
          }
        }
        if (rowHasNull)
          continue;
      }
      var row = {};
      for (var c = 0; c < numCols; c++) {
        var fieldName = formattedResult.fields[c].name;
        var fieldType = formattedResult.fields[c].type;
        var fieldIsArray = formattedResult.fields[c].is_array;
        var isNull = data.columns[c].nulls[r];
        if (isNull) {
          // row[fieldName] = "NULL";
          row[fieldName] = null;
          continue;
        }
        if (fieldIsArray) {
          row[fieldName] = [];
          var arrayNumElems = data.columns[c].data.arr_col[r].nulls.length;
          for (var e = 0; e < arrayNumElems; e++) {
            if (data.columns[c].data.arr_col[r].nulls[e]) {
              row[fieldName].push("NULL");
              continue;
            }
            switch(fieldType) {
              case "BOOL":
                row[fieldName].push(data.columns[c].data.arr_col[r].data.int_col[e] ? true : false);
                break;
              case "SMALLINT":
              case "INT":
              case "BIGINT":
                row[fieldName].push(data.columns[c].data.arr_col[r].data.int_col[e]);
                break;
              case "FLOAT":
              case "DOUBLE":
              case "DECIMAL":
                row[fieldName].push(data.columns[c].data.arr_col[r].data.real_col[e]);
                break;
              case "STR":
                row[fieldName].push(data.columns[c].data.arr_col[r].data.str_col[e]);
                break;
              case "TIME":
              case "TIMESTAMP":
              case "DATE":
                row[fieldName].push(data.columns[c].data.arr_col[r].data.int_col[e] * 1000);
                break;
            }
          }
        }
        else {
          switch (fieldType) {
            case "BOOL":
              row[fieldName] = data.columns[c].data.int_col[r] ? true : false;
              break;
            case "SMALLINT":
            case "INT":
            case "BIGINT":
              row[fieldName] = data.columns[c].data.int_col[r];
              break;
            case "FLOAT":
            case "DOUBLE":
            case "DECIMAL":
              row[fieldName] = data.columns[c].data.real_col[r];
              break;
            case "STR":
              row[fieldName] = data.columns[c].data.str_col[r];
              break;
            case "TIME":
            case "TIMESTAMP":
            case "DATE":
              row[fieldName] = new Date(data.columns[c].data.int_col[r] * 1000);
              break;
          }
        }
      }
      formattedResult.results.push(row);
    }
    return formattedResult;
  }

  /**
   * It should be avoided to query for row-based results from the server, howerver
   * it can still be done. In this case, still process them into the same format as
   * (@link processColumnarResults} to keep the output consistent.
   * @param {TRowSet} data - The row-based data returned from a query
   * @param {Boolean} eliminateNullRows
   * @returns {Object} processedResults 
   */
  processRowResults(data, eliminateNullRows) {
    var numCols = data.row_desc.length;
    var colNames = [];
    var formattedResult = { fields: [], results: [] };

    formattedResult.fields = data.row_desc.map((field, i) => {
      return {
        "name": field.col_name,
        "type": this._datumEnum[field.col_type.type],
        "is_array": field.col_type.is_array
      };
    });

    formattedResult.results = [];
    var numRows = 0;
    if (data.rows !== undefined && data.rows !== null){
      numRows = data.rows.length; // so won't throw if data.rows is missing
    }

    for (var r = 0; r < numRows; r++) {
      if (eliminateNullRows) {
        var rowHasNull = false;
        for (var c = 0; c < numCols; c++) {
          if (data.rows[r].columns[c].is_null) {
            rowHasNull = true;
            break;
          }
        }
        if (rowHasNull){
          continue;
        }
      }

      var row = {};
      for (var c = 0; c < numCols; c++) {
        var fieldName = formattedResult.fields[c].name;
        var fieldType = formattedResult.fields[c].type;
        var fieldIsArray = formattedResult.fields[c].is_array;
        if (fieldIsArray) {
          if (data.rows[r].cols[c].is_null) {
            row[fieldName] = "NULL";
            continue;
          }
          row[fieldName] = [];
          var arrayNumElems = data.rows[r].cols[c].val.arr_val.length;
          for (var e = 0; e < arrayNumElems; e++) {
            var elemDatum = data.rows[r].cols[c].val.arr_val[e];
            if (elemDatum.is_null) {
              row[fieldName].push("NULL");
              continue;
            }
            switch(fieldType) {
              case "BOOL":
                row[fieldName].push(elemDatum.val.int_val ? true : false);
                break;
              case "SMALLINT":
              case "INT":
              case "BIGINT":
                row[fieldName].push(elemDatum.val.int_val);
                break;
              case "FLOAT":
              case "DOUBLE":
              case "DECIMAL":
                row[fieldName].push(elemDatum.val.real_val);
                break;
              case "STR":
                row[fieldName].push(elemDatum.val.str_val);
                break;
              case "TIME":
              case "TIMESTAMP":
              case "DATE":
                row[fieldName].push(elemDatum.val.int_val * 1000);
                break;
            }
          }
        }
        else {
          var scalarDatum = data.rows[r].cols[c];
          if (scalarDatum.is_null) {
            row[fieldName] = "NULL";
            continue;
          }
          switch (fieldType) {
            case "BOOL":
              row[fieldName] = scalarDatum.val.int_val ? true : false;
              break;
            case "SMALLINT":
            case "INT":
            case "BIGINT":
              row[fieldName] = scalarDatum.val.int_val;
              break;
            case "FLOAT":
            case "DOUBLE":
            case "DECIMAL":
              row[fieldName] = scalarDatum.val.real_val;
              break;
            case "STR":
              row[fieldName] = scalarDatum.val.str_val;
              break;
            case "TIME":
            case "TIMESTAMP":
            case "DATE":
              row[fieldName] = new Date(scalarDatum.val.int_val * 1000);
              break;
          }
        }
      }
      formattedResult.results.push(row);
    }
    return formattedResult;
  }

  processResults(options, callbacks, result) {

    let isImage = false;
    let eliminateNullRows = false;
    let query = null;
    let queryId = null;
    let conId = null;
    let estimatedQueryTime = null;


    if (typeof options !== 'undefined') {
      isImage = options.isImage ? options.isImage : false;
      eliminateNullRows = options.eliminateNullRows ? options.eliminateNullRows : false;
      query = options.query ? options.query : null;
      queryId = options.queryId ? options.queryId : null; 
      conId = typeof options.conId !== 'undefined' ? options.conId : null;
      estimatedQueryTime = typeof options.estimatedQueryTime !== 'undefined' ? options.estimatedQueryTime : null;
    }
    if (result.execution_time_ms && conId !== null && estimatedQueryTime !== null) {
      this.serverQueueTimes[conId] -= estimatedQueryTime; 
      this.queryTimes[queryId] = result.execution_time_ms;
    }

    if (this._logging && result.execution_time_ms) {
      var server = (parseInt(result.nonce) % this._numConnections) + 1;
      console.log(query + " on Server " + server + " - Execution Time: " + result.execution_time_ms + " ms, Total Time: " + result.total_time_ms + "ms");
    }
    let hasCallback = !!callbacks; 

    if (isImage) {
      if (hasCallback) {
        callbacks.pop()(result, callbacks);
      }
      else {
        return result;
      }
    }
    else {
      result = result.row_set;
      var formattedResult = null;
      if (result.is_columnar) {
        formattedResult = this.processColumnarResults(result, eliminateNullRows);
      }
      else {
        formattedResult = this.processRowResults(result, eliminateNullRows);
      }
      if (hasCallback) {
        callbacks.pop()(formattedResult.results, callbacks);
      }
      else {
        return formattedResult.results;
      }
    }
  }

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
  getDatabases() {
    let databases = null;
    try {
      databases = this._client[0].get_databases();
      return databases.map((db, i) => { return db.db_name; });
    }
    catch (err) {
      console.error('ERROR: Could not get databases from backend. Check the session id.', err);
      throw err;
    }
  }

  getTables() {
    let tabs = null;
    try {
      tabs = this._client[0].get_tables(this._sessionId[0]);
    }
    catch (err) {
      console.error('ERROR: Could not get tables from backend', err);
      throw err;
    }

    let numTables = tabs.length;
    let tableInfo = [];
    for (var t = 0; t < numTables; t++) {
      tableInfo.push({
        "name": tabs[t],
        "label": "obs"
      });
    }
    return tableInfo;
  }

  invertDatumTypes() {
    for (var key in TDatumType) {
      this._datumEnum[TDatumType[key]] = key;
    }
  }

  getFields(tableName) {
    let fields = this._client[0].get_table_descriptor(this._sessionId[0], tableName);
    let fieldsArray = [];
    // silly to change this from map to array
    // - then later it turns back to map
    for (var key in fields) {
      fieldsArray.push({
        "name": key, 
        "type": this._datumEnum[fields[key].col_type.type],
        "is_array": fields[key].col_type.is_array,
        "is_dict": fields[key].col_type.encoding == TEncodingType["DICT"]
      });
    }
    return fieldsArray;
  }

  createTable(tableName, rowDesc, callback) {
    let result = null;
    try {
      for (var c = 0; c < this._numConnections; c++) 
        result = this._client[c].send_create_table(this._sessionId[c], tableName, rowDesc, callback);
    }
    catch (err) {
      console.error('ERROR: Could not create table', err);
      throw err;
    }
    return result;
  }

  importTable(tableName, fileName, copyParams, callback) {
    copyParams.delimiter = copyParams.delimiter || "";
    let result = null;
    try {
      for (var c = 0; c < this._numConnections; c++) 
        result = this._client[c].send_import_table(this._sessionId[c], tableName, fileName, copyParams, callback);
    }
    catch(err) {
      console.error('ERROR: Could not import table', err);
      throw (err);
    }
    return result;
  }

  importTableStatus(importId, callback) {
    callback = callback || null;
    let import_status = null;
    try {
      import_status = this._client[0].import_table_status(this._sessionId[0], importId, callback);
    }
    catch(err) {
      console.error('ERROR: Could not retrieve import status', err);
      throw (err);
    }
    return import_status;
  }

  getRowsForPixels(pixels, table_name, col_names, callbacks) {
    var widget_id = 1;  // INT
    var column_format = true; //BOOL
    callbacks = callbacks || null;
    var curNonce = (this._nonce++).toString();
    try {
      if (!callbacks){
        return this.processPixelResults(undefined, this._client[this._lastRenderCon].get_rows_for_pixels(this._sessionId[this._lastRenderCon], widget_id, pixels, table_name, col_names, column_format, curNonce));
      }
      this._client[this._lastRenderCon].get_rows_for_pixels(this._sessionId[this._lastRenderCon], widget_id, pixels, table_name, col_names, column_format, curNonce, this.processPixelResults.bind(this, callbacks));
    }
    catch(err) {
      console.error('Could not get rows for pixels', err);
      throw(err);
    }
    return curNonce;
  }

  processPixelResults(callbacks, results) {
    var results = results.pixel_rows;
    var numPixels = results.length;
    var resultsMap = {};
    var processResultsOptions = {
      isImage: false,
      eliminateNullRows: false,
      query: "pixel request",
      queryId: -2
    };
    for (var p = 0; p < numPixels; p++) {
      results[p].row_set = this.processResults(processResultsOptions, null, results[p]);
    }
    if (!callbacks){
      return results;
    }
    callbacks.pop()(results, callbacks);
  }

  getUploadServer(){
    return "";
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
    if (!arguments.length){
      return this._sessionId;
    }
    this._sessionId = sessionId;
    return this;
  }

  /**
   * Get or set the connection server hostname. This is is typically the first method called after instantiating a new MapdCon.
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
    if (!arguments.length){
      return this._host;
    }
    if (!Array.isArray(host))
      this._host = [host];
    else
      this._host = host;
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
    if (!arguments.length){
      return this._port;
    }
    if (!Array.isArray(port))
      this._port = [port];
    else
      this._port = port;
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
    if (!arguments.length){
      return this._user;
    }
    if (!Array.isArray(user))
      this._user = [user];
    else
      this._user = user;
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
    if (!arguments.length){
      return this._password;
    }
    if (!Array.isArray(password))
      this._password = [password];
    else
      this._password = password;
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
    if (!arguments.length){
      return this._dbName;
    }
    if (!Array.isArray(dbName))
      this._dbName = [dbName];
    else
      this._dbName = dbName;
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
    if (!arguments.length){
      return this.logging;
    }
    this._logging = logging;
    return this;
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
    if (!arguments.length){
      return this._platform;
    }
    this._platform = platform;
    return this;
  }

  /**
   * The MapDClient instance to perform queries with.
   * @param {MapDClient} [client] -  
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
    if (!arguments.length){
      return this._client;
    }
    this._client = client;
    return this;
  }

}

// Set a global mapdcon function when mapdcon is brought in via script tag.
if(typeof module === "object" && module.exports){
  if(window){
    window.MapdCon = MapdCon;
  }

}

export default new MapdCon();
