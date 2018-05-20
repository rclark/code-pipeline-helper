'use strict';

const AWS = require('aws-sdk');
const magic = require('@mapbox/magic-cfn-resources');
const AWSError = require('./aws-error');

const helper = module.exports = {};

class Pipeline {
  constructor(owner, repo, branch, Properties) {
    // aws clients
    this.sm = new AWS.SecretsManager();
    this.cp = new AWS.CodePipeline();

    // secret id in AWS Secrets Manager provided via env
    this.secretId = process.env.OAUTH_TOKEN_SECRET_ID;

    // clone CFN Properties and lowercase key names for the API calls
    this.properties = JSON.parse(
      JSON.stringify(Properties),
      (key, value) => {
        if (!value || typeof value !== 'object') return value;

        return Object.keys(value).reduce(
          (replacement, subkey) => {
            const k = `${subkey.charAt(0).toLowerCase()}${subkey.slice(1)}`;
            const v = value[subkey];
            replacement[k] = v;
            return replacement;
          },
          {}
        );
      }
    );

    // control the name, which is the pipeline's unique id
    this.id = `helper-${owner}-${repo}-${branch}`;

    // stash the repository data
    this.repository = { owner, repo, branch };
  }

  async addSource() {
    const secret = await this.sm.getSecretValue({ SecretId: this.secretId }).promise();
    const oauthToken = secret.SecretString;

    this.properties.stages.unshift({
      name: 'Source',
      actionType: {
        category: 'Source',
        owner: 'ThirdParty',
        version: '1',
        provider: 'Github'
      },
      outputArtifacts: [
        { name: 'Source' }
      ],
      configuration: Object.assign({ oauthToken }, this.repository)
    });
  }

  async create() {
    try {
      await this.cp.createPipeline({ pipeline: this.properties }).promise();
    } catch (err) {
      throw new AWSError(err);
    }
  }

  async update() {
    try {
      await this.cp.updatePipeline({ pipeline: this.properties }).promise();
    } catch (err) {
      throw new AWSError(err);
    }
  }

  async delete() {
    try {
      await this.cp.deletePipeline({ name: this.properties.name }).promise();
    } catch (err) {
      throw new AWSError(err);
    }
  }
}

helper.lambda = async (event, context) => {
  if (!magic.helpers.validateEvent(event))
    return context.done(null, '[error] Not a valid CloudFormation event');

  const response = new magic.helpers.Response(event, context);
  const requestType = event.RequestType.toLowerCase();
  const owner = event.ResourceProperties.Owner;
  const repo = event.ResourceProperties.Repo;
  const branch = event.ResourceProperties.Branch;

  delete event.ResourceProperties.Owner;
  delete event.ResourceProperties.Repo;
  delete event.ResourceProperties.Branch;

  const pipeline = new Pipeline(
    owner,
    repo,
    branch,
    event.ResourceProperties
  );

  try {
    await pipeline.addSource();
    await pipeline[requestType]();
    response.setId(pipeline.id);
    response.send();
  } catch (err) {
    response.send(err);
  }
};

helper.Pipeline = Pipeline;

