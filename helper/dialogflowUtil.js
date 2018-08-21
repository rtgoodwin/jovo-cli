'use strict';
const Helper = require('./lmHelper');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const _ = require('lodash');
const request = require('request');
const exec = require('child_process').exec;
const AdmZip = require('adm-zip');


module.exports = {

    /**
     * Returns base path to Alexa Skill
     * @return {string}
     */
    getPath: function() {
        return require('./googleActionUtil').getPath() + path.sep + 'dialogflow';
    },

    /**
     * Returns path to intents folder
     * @return {string}
     */
    getIntentsFolderPath: function() {
        return this.getPath() + path.sep + 'intents' + path.sep;
    },

    /**
     * Returns path to entities folder
     * @return {string}
     */
    getEntitiesFolderPath: function() {
        return this.getPath() + path.sep + 'entities' + path.sep;
    },


    /**
     * Returns path to DialogFlow package.json
     * @return {string}
     */
    getPackageJsonPath: function() {
        return this.getPath() + path.sep + 'package.json';
    },

    /**
     * package.json as object
     * @return {*}
     */
    getPackageJson: function() {
        return require(this.getPackageJsonPath());
    },

    /**
     * Path to agent.json
     * @return {string}
     */
    getAgentJsonPath: function() {
        return this.getPath() + path.sep + 'agent.json';
    },

    /**
     * agent.json as object
     * @return {*}
     */
    getAgentJson: function() {
        try {
            return require(this.getAgentJsonPath());
        } catch (error) {
            throw error;
        }
    },

    /**
     * Creates basic agent.json object
     * @param {Array<string>} locales
     * @return {*} object
     */
    createEmptyAgentJson: function(locales) {
        let agentJson = {
            description: '',
            // language: Helper.DEFAULT_LOCALE.substr(0, 2),
        };

        return agentJson;
    },

    /**
     * Builds agent.json from app.json
     * @param {*} ctx
     * @return {Promise<any>}
     */
    buildDialogFlowAgent: function(ctx) {
        return new Promise((resolve, reject) => {
            try {
                let config = Helper.Project.getConfig(ctx.stage);

                let agent;

                try {
                    agent = this.getAgentJson();
                } catch (err) {
                    agent = this.createEmptyAgentJson(ctx.locales);
                }

                // endpoint
                let url = null;
                    let globalConfig = Helper.Project.getConfig();
                    let stageConfig = _.get(Helper.Project.getConfig(), `stages.${ctx.stage}`);
                    url = _.get(stageConfig, 'googleAction.dialogflow.endpoint') ||
                        _.get(stageConfig, 'endpoint.googleAction.dialogflow') ||
                        _.get(stageConfig, 'endpoint') ||
                        _.get(globalConfig, 'googleAction.dialogflow.endpoint') ||
                        _.get(globalConfig, 'endpoint.googleAction.dialogflow') ||
                        _.get(globalConfig, 'endpoint');
                    url = Helper.Project.getEndpointFromConfig(url);
                if (url) {
                    _.merge(agent, {
                        'webhook': {
                            url: url,
                            available: true,
                        },
                    });
                }

                // setup languages
                if (ctx.locales.length === 1) {
                    _.set(agent, 'language', ctx.locales[0].substr(0, 2));
                    delete agent.supportedLanguages;
                } else {
                    let primLanguages = {};
                    let supportedLanguages = {};
                    for (let locale of ctx.locales) {
                        primLanguages[locale.substr(0, 2)] = '';
                        supportedLanguages[locale.toLowerCase()] = '';

                        let findings = ctx.locales.filter((loc) => {
                            return locale.substr(0, 2) === loc.substr(0, 2);
                        });
                        if (findings.length === 1) {
                            delete supportedLanguages[locale.toLowerCase()];
                            supportedLanguages[locale.toLowerCase().substr(0, 2)] = '';
                        }
                    }
                    if (Object.keys(primLanguages) === 1) {
                        _.set(agent, 'language', Object.keys(primLanguages)[0]);
                    } else {
                        if (Object.keys(primLanguages).indexOf('en')) {
                            _.set(agent, 'language', 'en');
                        } else {
                            _.set(agent, 'language', Object.keys(primLanguages)[0]);
                        }

                        agent.supportedLanguages = Object.keys(supportedLanguages);
                    }
                }

                if (_.get(config, 'googleAction.dialogflow.agent')) {
                    _.merge(agent, config.googleAction.dialogflow.agent);
                }
                // create package.json
                fs.writeFileSync(this.getPackageJsonPath(),
                    JSON.stringify({
                        version: '1.0.0',
                    }, null, '\t')
                );

                fs.writeFile(this.getAgentJsonPath(), JSON.stringify(agent, null, '\t'), function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    },

    getDefaultIntents: function() {
        return [
            {
                'name': 'Default Fallback Intent',
                'auto': true,
                'webhookUsed': true,
                'fallbackIntent': true,
            },
            {
                'name': 'Default Welcome Intent',
                'auto': true,
                'webhookUsed': true,
                'events': [
                    {
                        'name': 'WELCOME',
                    },
                ],
            },
        ];
    },

    /**
     * Builds Dialog Flow language model files from Jovo model
     * @param {string} locale
     * @param {string} stage
     * @return {Promise<any>}
     */
    buildLanguageModelDialogFlow: function(locale, stage) {
        return new Promise((resolve, reject) => {
            try {
                const DialogFlowAgent = require('./dialogFlowAgent').DialogFlowAgent;

                let dfa = new DialogFlowAgent({locale: locale});
                dfa.transform(locale, stage);
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    },

    /**
     * Archives Dialog Flow agent + models files
     * @return {Promise<any>}
     */
    zip: function() {
        return new Promise((resolve, reject) => {
            let zipPath = require('./googleActionUtil').getPath() + path.sep + 'dialogflow_agent.zip';
            let output = fs.createWriteStream(zipPath);
            let archive = archiver('zip', {
                zlib: {level: 9}, // Sets the compression level.
            });

            output.on('close', function() {
            });

            output.on('end', function() {
            });

            archive.on('warning', function(err) {
                if (err.code === 'ENOENT') {
                    // log warning
                } else {
                    // throw error
                    throw err;
                }
            });

            archive.on('error', function(err) {
                reject(err);
            });
            archive.pipe(output);
            let file1 = this.getPath() + path.sep + 'package.json';
            archive.append(fs.createReadStream(file1), {name: 'package.json'});
            let file2 = this.getPath() + path.sep + 'agent.json';
            archive.append(fs.createReadStream(file2), {name: 'agent.json'});

            archive.directory(this.getIntentsFolderPath(), 'intents');
            if (fs.existsSync(this.getEntitiesFolderPath())) {
                archive.directory(this.getEntitiesFolderPath(), 'entities');
            }
            archive.finalize();
            resolve(zipPath);
        });
    },

    getAgentFiles: function(config) {
        return this.v2.exportAgent(config).then((buf) => {
            let zip = new AdmZip(buf);
            zip.extractAllTo(this.getPath(), true);
        });
    },

    v2: {

        /**
         * Checks if Gcloud is installed
         * @return {Promise<any>}
         */
        checkGcloud: function() {
            return new Promise((resolve, reject) => {
                try {
                    exec('gcloud -v', function(error, stdout, stderr ) {
                        if (error) {
                            if (stderr) {
                                return reject(new Error('Your Google Cloud SDK isn\'t installed properly'));
                            }
                        }
                        if (!_.startsWith(stdout, 'Google Cloud SDK')) {
                            return reject(new Error('Your Google Cloud SDK isn\'t installed properly'));
                        }

                        resolve(stdout);
                    });
                } catch (error) {
                    console.log(error);
                }
            });
        },


        /**
         * Activate gcloud service account
         * @param {*} config
         * @return {Promise<any>}
         */
        activateServiceAccount: function(config) {
            return new Promise((resolve, reject) => {
                try {
                    exec('gcloud auth activate-service-account --key-file=' + config.keyFile, function(error, stdout, stderr ) {
                        if (error) {
                            if (stderr || error) {
                                return reject(new Error('Could not activate your service account: ' + stderr));
                            }
                        }
                        resolve();
                    });
                } catch (error) {
                    console.log(error);
                }
            });
        },
        /**
         * Retrieves access token from gcloud cli
         * @return {Promise<any>}
         */
        getAccessToken: function() {
            return new Promise((resolve, reject) => {
                try {
                    exec('gcloud auth print-access-token', function(error, stdout, stderr ) {
                        if (error) {
                            if (stderr) {
                                console.log(stderr);
                            }
                        }
                        resolve(stdout);
                    });
                } catch (error) {
                    console.log(error);
                }
            });
        },

        /**
         * Exports agent from given project id
         * @param {*} config
         * @return {Promise<any>}
         */
        exportAgent: function(config) {
            return new Promise((resolve, reject) => {
                this.getAccessToken().then((accessToken) => {
                    const options = {
                        method: 'POST',
                        url: `https://dialogflow.googleapis.com/v2beta1/projects/${config.projectId}/agent:export`, // eslint-disable-line
                        headers: {
                            Authorization: `Bearer ${accessToken.trim()}`,
                            accept: 'application/json',
                        },
                    };
                  request(options, function(error, response, body) {
                        if (error) {
                            return reject(error);
                        }
                        if (response.body.error) {
                            return reject(new Error(response.body.error.message));
                        }

                        try {
                            let res = JSON.parse(body);

                            if (res.error) {
                                return reject(new Error(res.error.message));
                            }
                            let buf = Buffer.from(res.response.agentContent, 'base64');

                            resolve(buf);
                        } catch (e) {
                            return reject(new Error(`Can't parse response object`));
                        }
                    });
                });
            });
        },

        /**
         * Uploads agent (zip) to Dialogflow
         * @param {*} config
         * @return {Promise<any>}
         */
        restoreAgent: function(config) {
            return new Promise((resolve, reject) => {
                this.getAccessToken().then((accessToken) => {
                    let zipdata = fs.readFileSync(config.pathToZip);
                    let content = {
                        agentContent: new Buffer(zipdata).toString('base64'),
                    };


                    const options = {
                        method: 'POST',
                        url: `https://dialogflow.googleapis.com/v2beta1/projects/${config.projectId}/agent:restore`, // eslint-disable-line
                        headers: {
                            Authorization: `Bearer ${accessToken.trim()}`,
                            accept: 'application/json',
                        },
                        json: content,
                    };
                    options.headers['Content-Type'] = 'application/json';
                    request(options, function(error, response, body) {
                        if (error) {
                            return reject(error);
                        }
                        if (response.body.error) {
                            return reject(new Error(response.body.error.message));
                        }
                        resolve(body);
                    });
                });
            });
        },

        /**
         * Starts training of agent for given project id
         * @param {*} config
         * @return {Promise<any>}
         */
        trainAgent: function(config) {
            return new Promise((resolve, reject) => {
                this.getAccessToken().then((accessToken) => {
                    const options = {
                        method: 'POST',
                        url: `https://dialogflow.googleapis.com/v2beta1/projects/${config.projectId}/agent:train`, // eslint-disable-line
                        headers: {
                            Authorization: `Bearer ${accessToken.trim()}`,
                            accept: 'application/json',
                        },
                    };
                    options.headers['Content-Type'] = 'application/json';
                    request(options, function(error, response, body) {
                        if (error) {
                            return reject(error);
                        }
                        if (response.body.error) {
                            return reject(new Error(response.body.error.message));
                        }
                        resolve(body);
                    });
                });
            });
        },
    },
};
