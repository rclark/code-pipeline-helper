## Some ideas

- A repository with a `staging` branch has a pipeline for deployment to the staging stack defined for that branch, one for the `production` stack defined for `master`. A watchbot-style template helper could write the pipeline CFN for someone, they would deploy it.

- Provide an arbitrary repo/branch + pipeline steps and system creates CFN for your pipeline + deploys it

- Provide arbitrary repo/branch + pipeline steps and system just creates your pipeline? Any value add?

- Provide basic pipelines allowing user to just provide repo/branch names
  - cloudformation deploy
  - docker image build
  - lambda bundling
  - bring-your-own codebuild project
  - bring-your-own lambda code
