define(function(require, module, exports) {
    main.consumes = [
        "Plugin", "test", "Form", "preferences", "proc", "watcher", "util", 
        "c9", "fs", "test.all", "dialog.error"
    ];
    main.provides = ["TestRunner"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var Form = imports.Form;
        var test = imports.test;
        var proc = imports.proc;
        var util = imports.util;
        var c9 = imports.c9;
        var fs = imports.fs;
        var showError = imports["dialog.error"].show;
        var prefs = imports.preferences;
        var all = imports["test.all"];
        
        var Node = test.Node;
        var File = test.File;
        
        var basename = require("path").basename;
        var dirname = require("path").dirname;

        function TestRunner(developer, deps, options) {
            var plugin = new Plugin(developer, deps);
            var emit = plugin.getEmitter();

            var caption = options.caption;
            var formOptions = options.options || [];
            var index = options.index || 100;
            var watcher = imports.watcher;
            var query = options.query;
            var meta = {};
            var form;
            
            var DEFAULTSCRIPT = query ? JSON.stringify(query.def, " ", 4) : "";
            
            var lookup = {};
            var update;
            
            /*
                query: {
                    id: "mocha",
                    label: "Mocha Test Runner",
                    def: {
                        match: {
                            content: ["^\\s*describe\\("],
                            filename: [".js$"]
                        },
                        exclude: {
                            dir: ["node_modules"],
                            file: []
                        },
                        search: "*"
                    }
                    {
                        "match": {
                            "content": ["\"use server\"", "\"use mocha\""],
                            "filename": [".js$"]
                        },
                        "exclude": {
                            "dir": ["node_modules", "build", "plugins/c9.fs/mock", "plugins/c9.ide.plugins/mock", "plugins/c9.profile/node_modules", "plugins/c9.ide.plugins/templates"],
                            "file": []
                        },
                        "search": "*"
                    }
                },
            */
            
            plugin.on("load", function(){
                test.register(plugin);
                
                if (!query) return;
                
                var prefDef = {
                    "Test" : {
                        position: 1000,
                    }
                };
                prefDef.Test[query.label] = {
                    position: query.position || 1000,
                    "Config To Fetch All Test Files In The Workspace" : {
                       name: "txtTest",
                       type: "textarea-row",
                       fixedFont: true,
                       width: 600,
                       height: 200,
                       rowheight: 250,
                       position: 1000
                   },
                };
                prefs.add(prefDef, plugin);
                
                plugin.getElement("txtTest", function(txtTest) {
                    var ta = txtTest.lastChild;
                    
                    ta.on("blur", function(e) {
                        if (test.config[query.id] == ta.value) return;
                        
                        // Validate
                        try { JSON.parse(ta.value); }
                        catch(e) { 
                            showError("Invalid JSON " + e.message); 
                            return;
                        }
                        
                        test.config[query.id] = ta.value;
                        test.saveConfig(function(){
                            plugin.update();
                        });
                    });
                    
                    test.on("ready", function(){
                        ta.setValue(test.config[query.id] || DEFAULTSCRIPT);
                    }, plugin);
                    test.on("updateConfig", function(){
                        ta.setValue(test.config[query.id] || DEFAULTSCRIPT);
                    }, plugin);
                }, plugin);
                
                function addFile(path, value){
                    if (isTest(path, value) && !all.findFileByPath(path)) {
                        createFile(path);
                        all.refresh();
                    }
                }
                
                function removeTestFile(path){
                    var fileNode = all.findFileByPath(path);
                    if (fileNode) {
                        plugin.root.items.remove(fileNode);
                        all.refresh();
                    }
                }
                
                function rmdir(path){
                    plugin.root.findAllNodes("file").forEach(function(fileNode){
                        if (fileNode.path.indexOf(path) === 0) {
                            plugin.root.items.remove(fileNode);
                        }
                    });
                    all.refresh();
                }
                
                fs.on("afterWriteFile", function(e){
                    addFile(e.path, e.args[1]);
                }, plugin);
                fs.on("afterUnlink", function(e){
                    removeTestFile(e.path);
                }, plugin);
                fs.on("afterRmfile", function(e){
                    removeTestFile(e.path);
                }, plugin);
                fs.on("afterRmdir", function(e){
                    rmdir(e.path);
                }, plugin);
                fs.on("afterCopy", function(e){
                    var fromPath = e.args[0];
                    var toPath = e.args[1];
                    
                    plugin.root.findAllNodes("file").forEach(function(fileNode){
                        if (fileNode.path.indexOf(fromPath) === 0) {
                            createFile(fileNode.path.replace(fromPath, toPath));
                        }
                    });
                    all.refresh();
                }, plugin);
                fs.on("afterRename", function(e){
                    var fromPath = e.args[0];
                    var toPath = e.args[1];
                    
                    plugin.root.findAllNodes("file").forEach(function(fileNode){
                        if (fileNode.path.indexOf(fromPath) === 0) {
                            fileNode.path = fileNode.path.replace(fromPath, toPath);
                            fileNode.label = fileNode.path.substr(1);
                        }
                    });
                    all.refresh();
                }, plugin);
                
                watcher.on("delete", function(e){
                    rmdir(e.path);
                }, plugin);
                watcher.on("directory", function(e){
                    var lut = {};
                    var path = e.path;
                    e.files.forEach(function(stat){
                        lut[path + "/" + stat.name] = true;
                    });
                    
                    plugin.root.findAllNodes("file").forEach(function(fileNode){
                        if (lut[fileNode.path]) {
                            delete lut[fileNode.path];
                            return;
                        }
                        if (fileNode.path.indexOf(path) === 0)
                            plugin.root.items.remove(fileNode);
                    });
                    
                    for (var p in lut) {
                        createFile(p);
                    }
                    
                    all.refresh();
                }, plugin);
                watcher.on("change", function(e){
                    var fileNode = all.findFileByPath(e.path);
                    if (fileNode && fileNode.status == "pending") {
                        plugin.update(fileNode, function(err){
                            if (!err) all.refresh();
                        });
                    }
                }, plugin);
            });
            
            plugin.on("unload", function(){
                test.unregister(plugin);
            });

            /***** Methods *****/
            
            function getForm(){
                if (!formOptions.length) return false;
                if (form) return form;
                
                form = new Form({ 
                    form: formOptions,
                    colwidth: 100,
                    style: "width:300px"
                }, plugin);
                
                return form;
            }
            
            function parseScript(def){
                var script = ["grep -lsR"];
                
                if ((def.match || 0).content) 
                    def.match.content.forEach(function(q){
                        script.push("-E " + makeArg(q));
                    });
                
                if ((def.exclude || 0).dir)
                    def.exclude.dir.forEach(function(q){
                        script.push("--exclude-dir " + makeArg(q));
                    });
                    
                if ((def.exclude || 0).file)
                    def.exclude.file.forEach(function(q){
                        script.push("--exclude " + makeArg(q));
                    });
                
                script.push(def.search);
                
                if ((def.match || 0).filename) 
                    def.match.filename.forEach(function(q){
                        if (q.charAt(0) == "-")
                            script.push("| grep -v " + makeArg(q.substr(1)));
                        else
                            script.push("| grep " + makeArg(q));
                    });
                
                return script.join(" ");
            }
            
            function makeArg(str){
                return "'" + str.replace(/'/g, "\\'") + "'";
            }
            
            function createFile(name, items){
                var file = new File({
                    label: name,
                    path: "/" + name
                });
                
                (items || plugin.root.items).push(file);
                lookup[name] = file;
                
                return file;
            }
            
            function getConfig(){
                try {
                    return test.config[query.id] 
                        ? JSON.parse(test.config[query.id]) 
                        : query.def;
                } catch(e) {
                    return query.def;
                }
            }
            
            function fetch(callback) {
                // return callback(null, "configs/client-config_test.js\nplugins/c9.api/quota_test.js\nplugins/c9.api/settings_test.js\nplugins/c9.api/sitemap-writer_test.js\nplugins/c9.api/stats_test.js\nplugins/c9.api/vfs_test.js\nplugins/c9.cli.publish/publish_test.js\nplugins/c9.analytics/analytics_test.js\nplugins/c9.api/base_test.js\nplugins/c9.api/collab_test.js\nplugins/c9.api/docker_test.js\nplugins/c9.api/package_test.js");
                // return callback(null, "classes/Twilio_TestAccounts.cls\nclasses/Twilio_TestApplication.cls\nclasses/Twilio_TestCalls.cls\nclasses/Twilio_TestCapability.cls\nclasses/Twilio_TestConference.cls\nclasses/Twilio_TestConnectApps.cls\nclasses/Twilio_TestMedia.cls\nclasses/Twilio_TestMember.cls\nclasses/Twilio_TestMessage.cls\nclasses/Twilio_TestNotification.cls\nclasses/Twilio_TestPhoneNumbers.cls\nclasses/Twilio_TestQueue.cls\nclasses/Twilio_TestRecording.cls\nclasses/Twilio_TestRest.cls\nclasses/Twilio_TestSandbox.cls\nclasses/Twilio_TestSms.cls\nclasses/Twilio_TestTwiML.cls");
                
                var script = parseScript(getConfig());
                
                if (c9.platform == "win32" && /grep/.test(script))
                    return callback(null, ""); // TODO DEFAULTSCRIPT is broken on windows
                
                proc.spawn("bash", {
                    args: ["-l", "-c", script],
                    cwd: c9.workspaceDir
                }, function(err, p) {
                    if (err) return callback(err);
                    
                    var stdout = "", stderr = "";
                    p.stdout.on("data", function(c){
                        stdout += c;
                    });
                    p.stderr.on("data", function(c){
                        stderr += c;
                    });
                    p.on("exit", function(){
                        callback(null, stdout);
                    });
                    
                });
            }
            
            function init(filter, callback) {
                /* 
                    Set hooks to update list
                    - Strategies:
                        - Periodically
                        * Based on fs/watcher events
                        - Based on opening the test panel
                        - Refresh button
                    
                    Do initial populate
                */
                
                var isUpdating;
                update = function(){
                    if (isUpdating) return fsUpdate(null, 10000);
                    
                    isUpdating = true;
                    plugin.fetch(function(err, list){
                        isUpdating = false;
                        
                        if (err) return callback(err);
                        
                        var items = [];
                        var lastLookup = lookup;
                        lookup = {};
                        
                        list.split("\n").forEach(function(name){
                            if (!name || filter("/" + name)) return;
                            
                            if (lastLookup[name]) {
                                items.push(lookup[name] = lastLookup[name]);
                                delete lastLookup[name];
                                return;
                            }
                            
                            createFile(name, items);
                        });
                        
                        plugin.root.items = items;
                        
                        callback(null, items);
                    });
                };
                
                var timer;
                function fsUpdate(e, time){
                    clearTimeout(timer);
                    timer = setTimeout(update, time || 1000);
                }
                
                emit("init");
                
                // Initial Fetch
                update();
            }
            
            /*
                query: {
                    id: "mocha",
                    label: "Mocha Test Runner",
                    def: {
                        match: {
                            content: ["^\\s*describe\\("],
                            filename: [".js$"]
                        },
                        exclude: {
                            dir: ["node_modules"],
                            file: []
                        },
                        search: "*"
                    }
                },
            */
            
            function isTest(path, value){
                var def = getConfig();
                
                var reSearch = util.escapeRegExp(def.search)
                    .replace(/\\*/g, ".*")
                    .replace(/\\?/g, ".");
                
                if (!path.match(reSearch)) return false;
                
                if (((def.match || 0).content || 0).length) {
                    if (!def.match.content.some(function(q){
                        return value.match(new RegExp(q));
                    })) return false;
                }
                
                var filename = basename(path);
                if (((def.match || 0).filename || 0).length) {
                    if (!def.match.filename.some(function(q){
                        if (q.charAt(0) == "-")
                            return !filename.match(new RegExp(q.substr(1)));
                        else
                            return filename.match(new RegExp(q));
                    })) return false;
                }
                
                var dirpath = dirname(path);
                if (((def.exclude || 0).dir || 0).length) {
                    if (def.exclude.dir.some(function(q){
                        return dirpath.match(new RegExp(q));
                    })) return false;
                }
                    
                if (((def.exclude || 0).file || 0).length) {
                    if (def.exclude.file.some(function(q){
                        return filename.match(new RegExp(q));
                    })) return false;
                }
                
                return true;
            }

            /***** Register and define API *****/
            
            plugin.freezePublicAPI.baseclass();

            plugin.freezePublicAPI({
                /**
                 * @property {String} caption
                 */
                get caption(){ return caption; },
                
                /**
                 * @property {Array} options
                 */
                get form(){ return getForm(); },
                
                /**
                 * 
                 */
                get meta(){ return meta; },
                
                /**
                 * 
                 */
                get update(){ return update },
                
                /**
                 * 
                 */
                isTest: isTest,
                
                /**
                 * 
                 */
                init: init,
                
                /**
                 * 
                 */
                fetch: fetch,
                
                /**
                 * @property {Object} root
                 */
                root: new Node({
                    label: caption,
                    index: index,
                    runner: plugin,
                    type: "runner"
                })
            });

            return plugin;
        }

        /***** Register and define API *****/

        register(null, {
            TestRunner: TestRunner
        });
    }
});
