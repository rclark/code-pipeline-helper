'use strict';

const cf = require('@mapbox/cloudfriend');
const pkg = require('../package.json');

const Parameters = {
  CodePipelineHelperVersion: {
    Type: 'String',
    Description: 'The version of code-pipeline-helper to deploy',
    Default: pkg.version
  },
  OAuthTokenSecretId: {
    Type: 'String',
    Description: 'The SecretId for a Github personal access token stored in AWS SecretsManager',
    Default: 'code-pipeline-helper/access-token'
  }
};

const Resources = {
  CustomResourceFunctionLogs: {
    Type: 'AWS::Logs::LogGroup',
    Description: 'Logs for the custom resource lambda function',
    Properties: {
      LogGroupName: cf.sub('/aws/lambda/${AWS::StackName}-custom-resource'),
      RetentionInDays: 14
    }
  },
  CustomResourceFunctionRole: {
    Type: 'AWS::IAM::Role',
    Description: 'Execution role for the custom resource lambda function',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole'
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
                Resource: cf.getAtt('CustomResourceFunctionLogs', 'Arn')
              },
              {
                Effect: 'Allow',
                Action: 'secretsmanager:GetSecretValue',
                Resource: '*',
                Condition: {
                  ArnLike: {
                    'secretsmanager:SecretId': cf.sub('arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${OAuthTokenSecretId}*')
                  }
                }
              },
              {
                Effect: 'Allow',
                Action: [
                  'codepipeline:CreatePipeline',
                  'codepipeline:UpdatePipeline',
                  'codepipeline:DeletePipeline',
                  'codepipeline:PutWebhook',
                  'codepipeline:DeleteWebhook',
                  'codepipeline:RegisterWebhookWithThirdParty',
                  'codepipeline:DeregisterWebhookWithThirdParty'
                ],
                Resource: '*'
              },
              {
                Effect: 'Allow',
                Action: 'iam:PassRole',
                Resource: '*'
              }
            ]
          }
        }
      ]
    }
  },
  CustomResourceFunction: {
    Type: 'AWS::Lambda::Function',
    Description: 'A Lambda function to use in other repositories to back a custom resource that maintainsan AWS::CodePipeline::Pipeline',
    Properties: {
      FunctionName: cf.sub('${AWS::StackName}-custom-resource'),
      Description: cf.sub('Custom CloudFormation resource backend for maintaining AWS::CodePipeline::Pipelines'),
      Runtime: 'nodejs8.10',
      Code: {
        S3Bucket: 'code-pipeline-helper',
        S3Key: cf.sub('${CodePipelineHelperVersion}.zip')
      },
      Handler: 'index.customResource',
      Environment: {
        Variables: {
          OAUTH_TOKEN_SECRET_ID: cf.ref('OAuthTokenSecretId')
        }
      },
      Role: cf.getAtt('CustomResourceFunctionRole', 'Arn'),
      MemorySize: 128,
      Timeout: 60
    }
  }
};

const Outputs = {
  CustomResourceFunction: {
    Description: 'The ServiceToken to use in a custom cloudformation resource which maintains an AWS::CodePipeline::Pipeline',
    Value: cf.getAtt('CustomResourceFunction', 'Arn'),
    Export: { Name: cf.sub('${AWS::StackName}-custom-resource') }
  }
};

module.exports = cf.merge({ Parameters, Resources, Outputs });
