'use strict';

const url = require('url');
const https = require('https');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const AWSError = require('./aws-error');

const helper = module.exports = {};

class Response {
  constructor(event) {
    console.log(`CloudFormation incoming data: ${JSON.stringify(event)}`);

    const parsedUrl = url.parse(event.ResponseURL);

    this.responseData = {
      PhysicalResourceId: event.PhysicalResourceId || crypto.randomBytes(16).toString('hex'),
      StackId: event.StackId,
      LogicalResourceId: event.LogicalResourceId,
      RequestId: event.RequestId
    };

    this.options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: 'PUT',
      headers: {
        'content-type': '',
        'content-length': 0
      }
    };
  }

  setId(id) {
    this.responseData.PhysicalResourceId = id;
  }

  send(err, data) {
    if (err) console.log(err);

    this.responseData.Status = err ? 'FAILED' : 'SUCCESS';
    this.responseData.Reason = err ? err.message || 'Unspecified failure' : '';
    this.responseData.Data = data;

    const body = JSON.stringify(this.responseData);
    const options = this.options;
    options.headers['content-length'] = body.length;

    console.log(`CloudFormation request body: ${JSON.stringify(this.responseData)}`);
    console.log(`CloudFormation request options: ${JSON.stringify(this.options)}`);

    return new Promise((resolve, reject) => {
      const sendResponse = (attempts) => {
        if (attempts > 5) return reject(new Error('Failed to respond to CloudFormation'));

        const req = https
          .request(options, (res) => {
            console.log(`CloudFormation response status: ${res.statusCode}`);

            res.setEncoding('utf8');
            res.on('data', (chunk) => console.log(chunk));

            res.on('end', () => {
              if (res.statusCode === 200) return resolve();
              reject(new Error('Failed to respond to CloudFormation'));
            });
          })
          .on('error', (requestError) => {
            console.log(requestError);
            attempts++;
            sendResponse(attempts);
          });

        req.write(body);
        req.end();
      };

      sendResponse(0);
    });
  }
}

class Pipeline {
  constructor(Owner, Repo, Branch, Properties) {
    // aws clients
    this.sm = new AWS.SecretsManager();
    this.cp = new AWS.CodePipeline();

    // secret id in AWS Secrets Manager provided via env
    this.secretId = process.env.OAUTH_TOKEN_SECRET_ID;

    // clone CFN Properties and lowercase key names for the API calls
    this.properties = JSON.parse(
      JSON.stringify(Properties),
      (key, value) => {
        if (!value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            key === 'Configuration'
          ) return value;

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

    // stash the repository data
    this.repository = { Owner, Repo, Branch, PollForSourceChanges: 'false' };
  }

  async addSource() {
    const secret = await this.sm.getSecretValue({ SecretId: this.secretId }).promise();
    const OAuthToken = secret.SecretString;

    this.properties.stages.unshift({
      name: 'Source',
      actions: [
        {
          name: 'GitHub',
          actionTypeId: {
            category: 'Source',
            owner: 'ThirdParty',
            version: '1',
            provider: 'GitHub'
          },
          outputArtifacts: [
            { name: 'Source' }
          ],
          configuration: Object.assign({ OAuthToken }, this.repository)
        }
      ]
    });
  }

  async addWebhook(register = false) {
    const secret = await this.sm.getSecretValue({ SecretId: this.secretId }).promise();
    const SecretToken = crypto
      .createHash('md5')
      .update(secret.SecretString)
      .digest('hex');


    const webhook = {
      name: `${this.properties.name}-webhook`,
      targetPipeline: this.properties.name,
      targetAction: 'GitHub',
      authentication: 'GITHUB_HMAC',
      authenticationConfiguration: { SecretToken },
      filters: [
        {
          jsonPath: '$.ref',
          matchEquals: 'refs/heads/{Branch}'
        }
      ]
    };

    await this.cp.putWebhook({ webhook }).promise();

    if (register)
      await this.cp.registerWebhookWithThirdParty({ webhookName: webhook.name }).promise();
  }

  async removeWebhook() {
    const webhookName = `${this.properties.name}-webhook`;
    await this.cp.deregisterWebhookWithThirdParty({ webhookName }).promise();
    await this.cp.deleteWebhook({ name: webhookName }).promise();
  }

  async create() {
    try {
      await this.cp.createPipeline({ pipeline: this.properties }).promise();
    } catch (err) {
      throw new AWSError(err);
    }

    try {
      await this.addWebhook(true);
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

    try {
      await this.addWebhook(true);
    } catch (err) {
      throw new AWSError(err);
    }
  }

  async delete() {
    try {
      await this.removeWebhook();
    } catch (err) {
      throw new AWSError(err);
    }

    try {
      await this.cp.deletePipeline({ name: this.properties.name }).promise();
    } catch (err) {
      throw new AWSError(err);
    }
  }
}

helper.lambda = async (event, context, callback) => {
  const response = new Response(event, context);
  const requestType = event.RequestType.toLowerCase();
  const owner = event.ResourceProperties.Owner;
  const repo = event.ResourceProperties.Repo;
  const branch = event.ResourceProperties.Branch;

  delete event.ResourceProperties.Owner;
  delete event.ResourceProperties.Repo;
  delete event.ResourceProperties.Branch;
  delete event.ResourceProperties.ServiceToken;

  const pipeline = new Pipeline(
    owner,
    repo,
    branch,
    event.ResourceProperties
  );

  try {
    await pipeline.addSource();
    await pipeline[requestType]();
    response.setId(pipeline.properties.name);
    await response.send();
  } catch (err) {
    await response.send(err);
  }

  callback();
};

helper.Pipeline = Pipeline;

