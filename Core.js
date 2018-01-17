// ==UserScript==
// @name        Wanikani Open Framework
// @namespace   rfindley
// @description Framework for writing scripts for Wanikani
// @version     1.00
// @include     https://www.wanikani.com/*
// @exclude     https://www.wanikani.com/login
// @copyright   2018+, Robin Findley
// @license     MIT; http://opensource.org/licenses/MIT
// @run-at      document-start
// @grant       none
// ==/UserScript==

(function(global) {
	'use strict';

	//########################################################################
	var wkof_version = '01.00';

	//------------------------------
	// Supported Modules
	//------------------------------
	var supported_modules = {
		'[version]': wkof_version,
		Apiv2:    { url: 'https://raw.githubusercontent.com/rfindley/wanikani-open-framework/master/Apiv2.js'},
		Menu:     { url: 'https://raw.githubusercontent.com/rfindley/wanikani-open-framework/master/Menu.js'          },
		Settings: { url: 'https://raw.githubusercontent.com/rfindley/wanikani-open-framework/master/Settings.js'      },
	};
	//########################################################################

	//------------------------------
	// Published interface
	//------------------------------
	var published_interface = {
		include: include,            // include(module_list)        => Promise
		ready:   ready,              // ready(module_list)          => Promise

		load_file:   load_file,      // load_file(url, use_cache)   => Promise
		load_css:    load_css,       // load_css(url, use_cache)    => Promise
		load_script: load_script,    // load_script(url, use_cache) => Promise

		file_cache: {
			dir: {},
			clear: file_cache_clear,   // clear()                   => Promise
			delete: file_cache_delete, // delete(name)              => Promise
			load:  file_cache_load,    // load(name)                => Promise
			save:  file_cache_save     // save(name, content)       => Promise
		},

		on:      wait_event,         // on(event, callback)         => Promise
		trigger: trigger_event,      // trigger(event[, data1[, data2[, ...]]])

		get_state: get_state,        // get(state_var)
		set_state: set_state,        // set(state_var, value)
		wait_state: wait_state,      // wait(state_var, value[, callback[, persistent]]) => if no callback, return one-shot Promise
	};

	//########################################################################

	function split_list(str) {return str.replace(/^\s+|\s*(,)\s*|\s+$/g, '$1').split(',').filter(function(name) {return (name.length > 0);});}
	function promise(){var a,b,c=new Promise(function(d,e){a=d;b=e;});c.resolve=a;c.reject=b;return c;}

	//########################################################################

	//------------------------------
	// Include a list of modules.
	//------------------------------
	var include_promises = {};

	function include(module_list) {
		if (wkof.get_state('wkof.wkof') !== 'ready')
			return wkof.ready('wkof').then(function(){return wkof.include(module_list);});
		var include_promise = promise();
		var module_names = split_list(module_list);
		var script_cnt = module_names.length;
		if (script_cnt === 0) {
			include_promise.resolve({loaded:[], failed:[]});
			return include_promise;
		}

		var done_cnt = 0;
		var loaded = [], failed = [];
		var no_cache = split_list(localStorage.getItem('wkof.include.nocache') || '');
		for (var idx = 0; idx < module_names.length; idx++) {
			var module_name = module_names[idx];
			var module = supported_modules[module_name];
			if (!module) {
				failed.push({name:module_name, url:undefined});
				check_done();
				continue;
			}
			var await_load = include_promises[module_name];
			var use_cache = no_cache.indexOf(module_name) < 0;
			if (!use_cache) file_cache_delete(module.url);
			if (await_load === undefined) include_promises[module_name] = await_load = load_script(module.url, use_cache);
			await_load.then(push_loaded, push_failed);
		}

		return include_promise;

		function push_loaded(url) {
			loaded.push(url);
			check_done();
		}

		function push_failed(url) {
			failed.push(url);
			check_done();
		}

		function check_done() {
			if (++done_cnt < script_cnt) return;
			if (failed.length === 0) include_promise.resolve({loaded:loaded, failed:failed});
			else include_promise.reject({error:'Failure loading module', loaded:loaded, failed:failed});
		}
	}

	//------------------------------
	// Wait for all modules to report that they are ready
	//------------------------------
	function ready(module_list) {
		var module_names = split_list(module_list);

		var ready_promises = [ ];
		for (var idx in module_names) {
			var module_name = module_names[idx];
			ready_promises.push(wait_state('wkof.' + module_name, 'ready'));
		}

		if (ready_promises.length === 0)
			return Promise.resolve();
		else if (ready_promises.length === 1)
			return ready_promises[0];
		else
			return Promise.all(ready_promises);
	}
	//########################################################################

	//------------------------------
	// Load a file asynchronously, and pass the file as resolved Promise data.
	//------------------------------
	function load_file(url, use_cache) {
		var fetch_promise = promise();
		if (use_cache) {
			return file_cache_load(url, use_cache).catch(fetch_url);
		} else {
			return fetch_url();
		}

		// Retrieve file from server
		function fetch_url(){
			var request = new XMLHttpRequest();
			request.onreadystatechange = process_result;
			request.open('GET', url, true);
			request.send();
			return fetch_promise;
		}

		function process_result(event){
			if (event.target.readyState !== 4) return;
			if (event.target.status >= 400 || event.target.status === 0) return reject(event.target.status);
			if (use_cache) {
				file_cache_save(url, event.target.response)
				.then(fetch_promise.resolve.bind(null,event.target.response));
			} else {
				fetch_promise.resolve(event.target.response);
			}
		}
	}

	//------------------------------
	// Load and install a specific file type into the DOM.
	//------------------------------
	function load_and_append(url, tag_name, location, use_cache) {
		if (document.querySelector(tag_name+'[uid="'+url+'"]') !== null) return Promise.resolve();
		return load_file(url, use_cache).then(append_to_tag);

		function append_to_tag(content) {
			var tag = document.createElement(tag_name);
			tag.innerHTML = content;
			tag.setAttribute('uid', url);
			document.querySelector(location).appendChild(tag);
			return url;
		}
	}

	//------------------------------
	// Load and install a CSS file.
	//------------------------------
	function load_css(url, use_cache) {
		return load_and_append(url, 'style', 'head', use_cache);
	}

	//------------------------------
	// Load and install Javascript.
	//------------------------------
	function load_script(url, use_cache) {
		return load_and_append(url, 'script', 'body', use_cache);
	}
	//########################################################################

	var state_listeners = {};
	var state_values = {};

	//------------------------------
	// Get the value of a state variable, and notify listeners.
	//------------------------------
	function get_state(state_var) {
		return state_values[state_var];
	}

	//------------------------------
	// Set the value of a state variable, and notify listeners.
	//------------------------------
	function set_state(state_var, value) {
		var old_value = state_values[state_var];
		if (old_value === value) return;
		state_values[state_var] = value;

		// Do listener callbacks, and remove non-persistent listeners
		var listeners = state_listeners[state_var];
		var persistent_listeners = [ ];
		for (var idx in listeners) {
			var listener = listeners[idx];
			var keep = true;
			if (listener.value === value || listener.value === '*') {
				keep = listener.persistent;
				try {
					listener.callback(value, old_value);
				} catch (e) {}
			}
			if (keep) persistent_listeners.push(listener);
		}
		state_listeners[state_var] = persistent_listeners;
	}

	//------------------------------
	// When state of state_var changes to value, call callback.
	// If persistent === true, continue listening for additional state changes
	// If value is '*', callback will be called for all state changes.
	//------------------------------
	function wait_state(state_var, value, callback, persistent) {
		var promise;
		if (callback === undefined) {
			promise = new Promise(function(resolve, reject) {
				callback = resolve;
			});
		}
		if (state_listeners[state_var] === undefined) state_listeners[state_var] = [ ];
		persistent = (persistent === true);
		var current_value = state_values[state_var];
		if (persistent || value !== current_value) state_listeners[state_var].push({callback:callback, persistent:persistent, value:value});

		// If it's already at the desired state, call the callback immediately.
		if (value === current_value) try {
			callback(value, current_value);
		} catch (err) {}
		return promise;
	}
	//########################################################################

	var event_listeners = {};

	//------------------------------
	// Fire an event, which then calls callbacks for any listeners.
	//------------------------------
	function trigger_event(event) {
		var listeners = event_listeners[event];
		if (listeners === undefined) return;
		var args = [];
		Array.prototype.push.apply(args,arguments);
		args.shift();
		for (var idx in listeners) try {
			listeners[idx].apply(null,args);
		} catch (err) {}
		return global.wkof;
	}

	//------------------------------
	// Add a listener for an event.
	//------------------------------
	function wait_event(event, callback) {
		if (event_listeners[event] === undefined) event_listeners[event] = [];
		event_listeners[event].push(callback);
		return global.wkof;
	}
	//########################################################################

	var file_cache_open_promise;

	//------------------------------
	// Open the file_cache database (or return handle if open).
	//------------------------------
	function file_cache_open() {
		if (file_cache_open_promise) return file_cache_open_promise;
		var open_promise = promise();
		file_cache_open_promise = open_promise;
		var request;
		request = indexedDB.open('wkof.file_cache');
		request.onupgradeneeded = upgrade_db;
		request.onsuccess = get_dir;
		return open_promise;

		function upgrade_db(event){
			var db = event.target.result;
			var store = db.createObjectStore('files', {keyPath:'name'});
		}

		function get_dir(event){
			var db = event.target.result;
			var transaction = db.transaction('files', 'readonly');
			var store = transaction.objectStore('files');
			var request = store.get('[dir]');
			request.onsuccess = process_dir;
			transaction.oncomplete = open_promise.resolve.bind(null, db);
		}

		function process_dir(event){
			if (event.target.result === undefined) {
				wkof.file_cache.dir = {};
			} else {
				wkof.file_cache.dir = JSON.parse(event.target.result.content);
			}
		}
	}

	//------------------------------
	// Clear the file_cache database.
	//------------------------------
	function file_cache_clear() {
		return file_cache_open().then(clear);

		function clear(db) {
			var clear_promise = promise();
			wkof.file_cache.dir = {};
			var transaction = db.transaction('files', 'readwrite');
			var store = transaction.objectStore('files');
			store.clear();
			transaction.oncomplete = clear_promise.resolve;
		}
	}

	//------------------------------
	// Delete a file from the file_cache database.
	//------------------------------
	function file_cache_delete(name) {
		return file_cache_open().then(del);

		function del(db) {
			var del_promise = promise();
			var transaction = db.transaction('files', 'readwrite');
			var store = transaction.objectStore('files');
			store.delete(name);
			delete wkof.file_cache.dir[name];
			file_cache_dir_save();
			transaction.oncomplete = del_promise.resolve.bind(null, name);
		}
	}

	//------------------------------
	// Load a file from the file_cache database.
	//------------------------------
	function file_cache_load(name) {
		var load_promise = promise();
		return file_cache_open().then(load);

		function load(db) {
			if (wkof.file_cache.dir[name] === undefined) {
				load_promise.reject(name);
				return load_promise;
			}
			var transaction = db.transaction('files', 'readonly');
			var store = transaction.objectStore('files');
			var request = store.get(name);
			wkof.file_cache.dir[name].last_loaded = new Date().toLocaleString();
			file_cache_dir_save();
			request.onsuccess = finish;
			request.onerror = error;
			return load_promise;

			function finish(event){
				if (event.target.result === undefined)
					load_promise.reject(name);
				else
					load_promise.resolve(event.target.result.content);
			}

			function error(event){
				load_promise.reject(name);
			}
		}
	}

	//------------------------------
	// Save a file into the file_cache database.
	//------------------------------
	function file_cache_save(name, content, extra_attribs) {
		return file_cache_open().then(save);

		function save(db) {
			var save_promise = promise();
			var transaction = db.transaction('files', 'readwrite');
			var store = transaction.objectStore('files');
			store.put({name:name,content:content});
			var now = new Date().toLocaleString();
			wkof.file_cache.dir[name] = Object.assign({added:now, last_loaded:now}, extra_attribs);
			file_cache_dir_save(true /* immediately */);
			transaction.oncomplete = save_promise.resolve.bind(null, name);
		}
	}

	//------------------------------
	// Save a the file_cache directory contents.
	//------------------------------
	var fc_sync_timer;
	function file_cache_dir_save(immediately) {
		if (fc_sync_timer !== undefined) clearTimeout(fc_sync_timer);
		var delay = (immediately ? 0 : 2000);
		fc_sync_timer = setTimeout(save, delay);

		function save(){
			file_cache_open().then(save2);
		}

		function save2(db){
			fc_sync_timer = undefined;
			var transaction = db.transaction('files', 'readwrite');
			var store = transaction.objectStore('files');
			store.put({name:'[dir]',content:JSON.stringify(wkof.file_cache.dir)});
		}
	}

	function doc_ready() {
		wkof.set_state('wkof.document', 'ready');
	}

	//########################################################################
	// Bootloader Startup
	//------------------------------
	function startup() {
		global.wkof = published_interface;

		// Mark document state as 'ready'.
		if (document.readyState === 'complete')
			doc_ready();
		else
			window.addEventListener("load", doc_ready, false);	// Notify listeners that we are ready.

		// Open cache, so wkof.file_cache.dir is available to console immediately.
		file_cache_open();
		wkof.set_state('wkof.wkof', 'ready');
	}
	startup();

})(window);
