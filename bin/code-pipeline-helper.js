#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const cp = require('child_process');
const util = require('util');
const AWS = require('aws-sdk');

const exec = util.promisify(cp.exec);

const commands = module.exports = {};

commands['set-oauth-secret'] = async ([token, region = 'us-east-1']) => {
  if (!token)
    throw new Error('No Github personal access token was provided');

  const sm = new AWS.SecretsManager({ region });
  const name = 'code-pipeline-helper/access-token';

  let exists = false;
  try {
    await sm.describeSecret({ SecretId: name }).promise();
    exists = true;
  } catch (err) {
    if (err.code !== 'ResourceNotFoundException') throw err;
  }

  const response = exists
    ? await sm.putSecretValue({
      SecretId: name,
      SecretString: token
    }).promise()
    : await sm.createSecret({
      Name: name,
      Description: 'A Github personal access token for use in a code-pipeline-helper stack',
      SecretString: token
    }).promise();

  console.log(`Created secret ${response.Name} version ${response.VersionId}`);
};

commands['upload-bundle'] = async ([location = 'code-pipeline-helper']) => {
  const s3 = new AWS.S3();

  const Bucket = location.split('/')[0];
  const prefix = location.split('/').slice(1).join('/');

  const options = { cwd: path.resolve(__dirname, '..') };
  const sha = (await exec('git rev-parse HEAD', options)).stdout.trim();

  let version;
  try { version = (await exec('git describe --tags --exact-match', options)).stdout.trim(); }
  catch (err) { false; }

  const tmp = `${path.join(os.tmpdir(), crypto.randomBytes(8).toString('hex'))}.zip`;

  await exec('npm ci --production', options);
  await exec(`zip -rq --exclude=".git*" ${tmp} .`, options);

  await s3.putObject({
    Bucket,
    Key: `${prefix ? prefix + '/' : ''}${sha}.zip`,
    Body: fs.createReadStream(tmp),
    ACL: 'public-read'
  }).promise();

  console.log(`Uploaded bundle to s3://${Bucket}/${prefix ? prefix + '/' : ''}${sha}.zip`);

  if (version) {
    await s3.putObject({
      Bucket,
      Key: `${prefix ? prefix + '/' : ''}${version}.zip`,
      Body: fs.createReadStream(tmp),
      ACL: 'public-read'
    }).promise();

    console.log(`Uploaded bundle to s3://${Bucket}/${prefix ? prefix + '/' : ''}${version}.zip`);
  }

  await exec('npm ci', options);
};

if (require.main === module) {
  const command = process.argv[2];

  if (!new Set(['set-oauth-secret', 'upload-bundle']).has(command))
    throw new Error(`Invalid or missing command: ${command}`);

  const action = commands[command];
  action(process.argv.slice(3))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
