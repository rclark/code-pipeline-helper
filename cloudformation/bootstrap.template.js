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
              },
              {
                Effect: 'Allow',
                Action: [
                  's3:ListBucket',
                  's3:GetObject',
                  's3:PutObject',
                  's3:PutObjectAcl'
                ],
                Resource: [
                  cf.sub('arn:${AWS::Partition}:s3:::code-pipeline-helper'),
                  cf.sub('arn:${AWS::Partition}:s3:::code-pipeline-helper/*')
                ]
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
        Type: 'CODEPIPELINE'
      },
      Environment: {
        Type: 'LINUX_CONTAINER',
        ComputeType: 'BUILD_GENERAL1_SMALL',
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
                - npm install -g npm@5.8.0
                - npm ci --production
            build:
              commands:
                - node bin/code-pipeline-helper upload-bundle
        `) // @TODO: doesn't have .git folder for git commands to find tag
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
              {
                Effect: 'Allow',
                Action: [
                  's3:ListBucket',
                  's3:GetBucketVersioning',
                  's3:GetObject',
                  's3:GetObjectVersion',
                  's3:PutObject'
                ],
                Resource: [
                  cf.sub('arn:${AWS::Partition}:s3:::code-pipeline-helper'),
                  cf.sub('arn:${AWS::Partition}:s3:::code-pipeline-helper/*')
                ]
              },
              {
                Effect: 'Allow',
                Action: [
                  'codebuild:StartBuild',
                  'codebuild:BatchGetBuilds'
                ],
                Resource: cf.getAtt('Bundler', 'Arn')
              }
            ]
          }
        }
      ]
    }
  },
  Pipeline: {
    Type: 'Custom::CodePipelineHelper',
    Properties: {
      ServiceToken: cf.importValue('code-pipeline-helper-production-custom-resource'),
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
