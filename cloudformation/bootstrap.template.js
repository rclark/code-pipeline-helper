'use strict';

const redent = require('redent');
const cf = require('@mapbox/cloudfriend');

const Parameters = {
  GitSha: { Type: 'String' }
};

const Resources = {
  BundlerLogs: {
    Type: 'AWS::Logs::LogGroup',
    Properties: {
      LogGroupName: cf.sub('/aws/codebuild/${AWS::StackName}-bundler'),
      RetentionInDays: 14
    }
  },
  BundlerRole: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Principal: { Service: 'codebuild.amazonaws.com' }
          }
        ]
      },
      Policies: [
        {
          PolicyName: 'main',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: 'logs:*',
                Resource: cf.getAtt('BundlerLogs', 'Arn')
              }
            ]
          }
        }
      ]
    }
  },
  Bundler: {
    Type: 'AWS::CodeBuild::Project',
    Properties: {
      Name: cf.sub('${AWS::StackName}-bundler'),
      Description: 'Uploads code-pipeline-helper bundles',
      Artifacts: {
        Type: 'no_artifacts'
      },
      Environment: {
        Type: 'LINUX_CONTAINER',
        ComputeType: 'BUILD_GENERAL_SMALL',
        Image: 'aws/codebuild/nodejs:8.11.0'
      },
      ServiceRole: cf.getAtt('BundlerRole', 'Arn'),
      Source: {
        Type: 'CODEPIPELINE',
        BuildSpec: redent(`
          version: 0.2
          phases:
            install:
              commands:
                - npm ci --production
            pre_build:
              commands:
                - export SHA=$(git rev-parse HEAD)
                - export TAG=$(git describe --tags --exact-match 2> /dev/null)
                - rm -rf .git/
            build:
              commands:
                - zip -rq \${TMPDIR}/\${SHA}.zip .
                - [ -n "\${TAG}" ] && cp \${TMPDIR}/\${SHA}.zip \${TMPDIR}/\${TAG}.zip
            post_build:
              commands:
                - export SHA_EXISTS=$(aws s3 ls s3://code-pipeline-helper/\${SHA}.zip)
                - [ -z "\${SHA_EXISTS}" ] && aws s3 cp s3://code-pipeline-helper/\${SHA}.zip
                - export TAG_EXISTS=$(aws s3 ls s3://code-pipeline-helper/\${TAG}.zip)
                - [ -n "\${TAG}" ] && [ -z "\${TAG_EXISTS}" ]aws s3 cp s3://code-pipeline-helper/\${TAG}.zip
        `)
      }
    }
  },
  PipelineRole: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Principal: { Service: 'codepipeline.amazonaws.com' }
          }
        ]
      },
      Policies: [
        {
          PolicyName: 'main',
          PolicyDocument: {
            Statement: [

            ]
          }
        }
      ]
    }
  },
  Pipeline: {
    Type: 'Custom::CodePipelineHelper',
    Properties: {
      ServiceToken: cf.importValue('code-pipeline-helper'),
      Owner: 'rclark',
      Repo: 'code-pipeline-helper',
      Branch: 'master',
      Name: cf.stackName,
      RoleArn: cf.getAtt('PipelineRole', 'Arn'),
      ArtifactStore: {
        Type: 'S3',
        Location: 'code-pipeline-helper'
      },
      Stages: [
        {
          Name: 'Bundle',
          Actions: [
            {
              Name: 'Bundle',
              ActionTypeId: {
                Category: 'Build',
                Owner: 'AWS',
                Version: '1',
                Provider: 'CodeBuild'
              },
              InputArtifacts: [
                { Name: 'Source' }
              ],
              Configuration: {
                ProjectName: cf.ref('Bundler')
              }
            }
          ]
        }
      ]
    }
  }
};

module.exports = cf.merge({ Parameters, Resources });
