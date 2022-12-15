const { Stack, Duration } = require("aws-cdk-lib");
const sqs = require("aws-cdk-lib/aws-sqs");
const ecs = require("aws-cdk-lib/aws-ecs");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecr = require("aws-cdk-lib/aws-ecr");
const ecsp = require("aws-cdk-lib/aws-ecs-patterns");
const iam = require("aws-cdk-lib/aws-iam");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const route53 = require("aws-cdk-lib/aws-route53");
const targets = require("aws-cdk-lib/aws-route53-targets");
const elb = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const rds = require("aws-cdk-lib/aws-rds");
const s3 = require("aws-cdk-lib/aws-s3");
const cf = require("aws-cdk-lib/aws-cloudfront");
const cdk = require("aws-cdk-lib");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const cb = require("aws-cdk-lib/aws-codebuild");
const cpa = require("aws-cdk-lib/aws-codepipeline-actions");
const cp = require("aws-cdk-lib/aws-codepipeline");
const asca = require("aws-cdk-lib/aws-autoscaling");
const aas = require("aws-cdk-lib/aws-applicationautoscaling");
const e = require("aws-cdk-lib/aws-events");
const et = require("aws-cdk-lib/aws-events-targets");
const ssm = require("aws-cdk-lib/aws-ssm");
const { EcsRunTask } = require("aws-cdk-lib/aws-stepfunctions-tasks");
const docdb = require("aws-cdk-lib/aws-docdb");
const elasticache = require("aws-cdk-lib/aws-elasticache");
const dax = require("aws-cdk-lib/aws-dax");

//const vpc = ec2.Vpc;
//@TODO: add autoscaling for testnet

class SpaceridersCdkStack extends Stack {
  createVpc(name) {
    return new ec2.Vpc(this, name, {
      natGateways: 1,
      maxAzs: 2,
    });
    
  }

  createEcsCluster(name, vpc) {
    return new ecs.Cluster(this, name, {
      clusterName: name,
      vpc: vpc,
    });
  }

  createSsmSecret(name, value) {
    return new secretsmanager.Secret(this, name, {
      secretStringBeta1:
        secretsmanager.SecretStringValueBeta1.fromUnsafePlaintext(value),
    });
  }

  createLb(id, vpc, internetFacing) {
    return new elb.ApplicationLoadBalancer(this, id, {
      vpc,
      internetFacing: internetFacing,
      idleTimeout: cdk.Duration.seconds(600),
    });
  }

  fetchHostedZone(name, hostedZone, hostedZoneId) {
    return route53.HostedZone.fromHostedZoneAttributes(this, name, {
      zoneName: hostedZone,
      hostedZoneId: hostedZoneId,
    });
  }

  createRole(roleName, assume) {
    return new iam.Role(this, roleName, {
      assumedBy: new iam.ServicePrincipal(assume),
    });
  }

  createSpaBucket(id, name, domain, redirectProtocol, publicAccess) {
    return new s3.Bucket(this, id, {
      bucketName: name,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "index.html",
      publicReadAccess: publicAccess,
      removalPolicy: "destroy",
      autoDeleteObjects: true,
      websiteRoutingRules: [
        {
          hostName: domain,
          protocol: redirectProtocol,
          replaceKey: s3.ReplaceKey.prefixWith("#/"),
          condition: {
            httpErrorCodeReturnedEquals: "403",
          },
        },
        {
          hostName: domain,
          protocol: redirectProtocol,
          replaceKey: s3.ReplaceKey.prefixWith("#/"),
          condition: {
            httpErrorCodeReturnedEquals: "404",
          },
        },
      ],
    });
  }

  sprCertificate() {
    return acm.Certificate.fromCertificateArn(
      this,
      "spaceriders-ssl",
      "arn:aws:acm:us-east-1:657117221658:certificate/b9bae659-1b97-4977-aee0-85371a3148cc"
    );
  }

  apiSprCertificate() {
    return acm.Certificate.fromCertificateArn(
      this,
      "api-spaceriders-ssl",
      "arn:aws:acm:eu-west-1:657117221658:certificate/57548242-3240-4b8d-bb7a-ad01b8f5d60e"
    );
  }

  createCfDistribution(id, certificate, domain, bucket, oai) {
    return new cf.CloudFrontWebDistribution(this, id, {
      viewerCertificate: cf.ViewerCertificate.fromAcmCertificate(certificate, {
        aliases: [domain],
        securityPolicy: cf.SecurityPolicyProtocol.TLS_V1_2_2021, // default
      }),
      originConfigs: [
        {
          //alias
          s3OriginSource: {
            s3BucketSource: bucket,
            originAccessIdentity: oai,
          },
          behaviors: [{ isDefaultBehavior: true }],
        },
      ],
      errorConfigurations: [
        {
          errorCode: 403,
          responsePagePath: "/index.html",
          responseCode: 200,
        },
        {
          errorCode: 404,
          responsePagePath: "/index.html",
          responseCode: 200,
        },
      ],
    });
  }

  constructor(scope, id, props) {
    //@TODO: Use ec2 ecs cluster: https://stackoverflow.com/questions/36462657/how-to-register-ec2-instance-to-ecs-cluster
    
    //@TODO: https://docs.aws.amazon.com/cdk/api/v1/docs/aws-ecs-readme.html
    //@TODO: https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.AddCapacityOptions.html
    
    //@TODO: https://stackoverflow.com/a/64215125
    super(scope, id, props);

    const vpc = this.createVpc("MainVPC");
    const certificate = this.sprCertificate();


    /*const dbPass = this.createSsmSecret(
      "db-passs",
      '{"username": "root","password": "password"}'
    );*/

    const role = this.createRole("allowecr", "ecs-tasks.amazonaws.com");
    role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ecr:*"],
        resources: ["*"],
      })
    );

    const sprDomain = this.fetchHostedZone(
      "sprDomain",
      "spaceriders.io",
      "Z042842830PEVAO6DPQ8P"
    );

    const ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      "spaceriders-api",
      "spaceriders-api"
    );



    const spaMainnetBucket = this.createSpaBucket(
      "spr-bucket-mainnet",
      "spaceriders-mainnet-frontend-spa",
      "spaceriders.io",
      s3.RedirectProtocol.HTTPS,
      false,
    );

    const spaTestnetBucket = this.createSpaBucket(
      "spr-bucket-testnet",
      "testnet.spaceriders.io",
      "testnet.spaceriders.io",
      s3.RedirectProtocol.HTTP,
      true
    );

    const oai = new cf.OriginAccessIdentity(this, "SprOAI");
    spaMainnetBucket.grantRead(oai);

    const distribution = this.createCfDistribution(
      "SpaceridersDistribution",
      certificate,
      "spaceriders.io",
      spaMainnetBucket,
      oai
    );
    
    const spaArtifactBucket = new s3.Bucket(this, 'SpaArtifactBucket', {
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const spaPipeline = new cp.Pipeline(this, "Spaceriders SPA", {
      pipelineName: "spa",
      artifactBucket: spaArtifactBucket
    });

    const spaSourceOutput = new cp.Artifact();
    spaPipeline.addStage({
      stageName: "Source",
      actions: [
        new cpa.GitHubSourceAction({
          actionName: "GitHub_Source",
          owner: "redigaffi",
          repo: "spaceriders-frontend",
          oauthToken: cdk.SecretValue.plainText(
            "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"
          ),
          output: spaSourceOutput,
          branch: "master", // default: 'master'
        }),
      ],
    });

    const buildProject = new cb.PipelineProject(this, "Build Spaceriders SPA", {
      projectName: `spr-spa-build`,
      buildSpec: cb.BuildSpec.fromSourceFilename("./buildspec.yml"),
      environment: {
        buildImage: cb.LinuxBuildImage.STANDARD_4_0,
      },
    });
    //spaMainnetBucket.grantReadWrite(buildProject);
    //spaTestnetBucket.grantReadWrite(buildProject);

    //https://github.com/aws/aws-cdk/issues/4928
    const spaTestnetBuildOutput = new cp.Artifact();
    spaPipeline.addStage({
      stageName: "Build",
      actions: [
        new cpa.CodeBuildAction({
          actionName: "Build",
          project: buildProject,
          input: spaSourceOutput,
          outputs: [spaTestnetBuildOutput],
          environmentVariables: {
            BASE_API_PATH: { value: "https://api.testnet.spaceriders.io" },
            BASE_WS_PATH: {value: "wss://ws.testnet.spaceriders.io/ws"},
            ENV: {value: "testnet"},
            GA_MEASUREMENT_ID: {value: "G-D1B6V8LGPL"},
            FACE_WALLET_API_KEY: {value: "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCcvnhTF-1PTlWAkwewlBesX5sdoiwRisLWi7TIVUFY895dh1NwzR7BpfmEBNbi7aHU_xtWs0tpM-R6Ah9hH4Wcts2IgnzGxrKokyqrqr4ymoUmJLKerf843D32CUJNXOGX4LJHZrfyjHIHDQzZRyMSav9DLjjJSfH4G53bOwnkkQIDAQAB"},
          },
        }),
      ],
    });

    spaPipeline.addStage({
      stageName: "DeployTestnet",
      actions: [
        new cpa.S3DeployAction({
          actionName: 'S3Deploy',
          bucket: spaTestnetBucket,
          input: spaTestnetBuildOutput,
          runOrder: 1,
        })
      ],
    });
    
    const invalidateCloudfront = new cb.PipelineProject(this, `InvalidateProject`, {
      buildSpec: cb.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands:[
              'aws cloudfront create-invalidation --distribution-id ${CLOUDFRONT_ID} --paths "/*"',
            ],
          },
        },
      }),
      environmentVariables: {
        CLOUDFRONT_ID: { value: distribution.distributionId },
      },
    });

    invalidateCloudfront.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["cloudfront:CreateInvalidation"],
      })
    );
    
    const spaMainnetBuildOutput = new cp.Artifact();
    spaPipeline.addStage({
      stageName: "Mainnet",
      actions: [
        new cpa.ManualApprovalAction({
          actionName: "Approve",
          runOrder: 1,
        }),
        new cpa.CodeBuildAction({
          actionName: "Build",
          project: buildProject,
          input: spaSourceOutput,
          outputs: [spaMainnetBuildOutput],
          environmentVariables: {
            BASE_API_PATH: { value: "https://api.mainnet.spaceriders.io" },
            BASE_WS_PATH: {value: "wss://ws.mainnet.spaceriders.io/ws"},
            ENV: {value: "mainnet"},
            GA_MEASUREMENT_ID: {value: "G-CXNZDQ8FKK"},
            FACE_WALLET_API_KEY: {value: "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC2Cj98opTEWmGVLe0Fo39PXumN6cFQregIWUlNZpcjPrdphRR4LyS9CkhBcAEI1-2LI3A94HA9j-_PpV4ALeQvlzYMUZdHoi3SZyeZeWhDrGbhkrzDXzN7IPwYIcniqpG3LpRtRtG0qeRWTququYM5LDZFsMfm6tTaEvXqLGi14wIDAQAB"},

          },
          runOrder: 2,
        }),
        new cpa.S3DeployAction({
          actionName: 'S3Deploy',
          bucket: spaMainnetBucket,
          input: spaMainnetBuildOutput,
          runOrder: 3,
        }),
        new cpa.CodeBuildAction({
          actionName: 'InvalidateCache',
          project: invalidateCloudfront,
          input: spaMainnetBuildOutput,
          runOrder: 4,
        }),
      ],
    });

    const apiArtifactBucket = new s3.Bucket(this, 'ApiArtifactBucket', {
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apipipeline = new cp.Pipeline(this, "Spaceriders API", {
      pipelineName: "api",
      artifactBucket: apiArtifactBucket,
    });

    const apisourceOutput = new cp.Artifact();
    const apisourceAction = new cpa.GitHubSourceAction({
      actionName: "GitHub_Source",
      owner: "redigaffi",
      repo: "spaceriders-apiv2",
      oauthToken: cdk.SecretValue.plainText(
        "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"
      ),
      output: apisourceOutput,
      branch: "master", // default: 'master'
    });

    apipipeline.addStage({
      stageName: "Source",
      actions: [apisourceAction],
    });

    const apibuildProject = new cb.PipelineProject(
      this,
      "Build Spaceriders API",
      {
        projectName: `spr-api-build`,
        buildSpec: cb.BuildSpec.fromSourceFilename("./buildspec.yml"),
        environment: {
          buildImage: cb.LinuxBuildImage.STANDARD_4_0,
          privileged: true,
        },
      }
    );

    apipipeline.addStage({
      stageName: "Build",
      actions: [
        new cpa.CodeBuildAction({
          actionName: "Build",
          project: apibuildProject,
          input: apisourceOutput,
          environmentVariables: {
            REGISTRY: { value: ecrRepository.repositoryUri },
          },
        }),
      ],
    });

   

    const apiProdBuildProject = new cb.PipelineProject(
      this,
      "Build Spaceriders PROD API",
      {
        projectName: `spr-api-build-prod`,
        buildSpec: cb.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            build: { commands: [
              'docker login -u AWS -p $(aws ecr get-login-password --region eu-west-1) $REGISTRY',
              'docker pull $REGISTRY:stg-latest',
              'docker tag $REGISTRY:stg-latest $REGISTRY:prod-latest',
              'docker push $REGISTRY:prod-latest',
              'curl -X POST https://portainer.spaceriders.io/api/webhooks/df8f9af6-f147-44df-91ed-3389272699b8',
              'curl -X POST https://portainer.spaceriders.io/api/webhooks/a73c8a06-6273-4760-b876-613c3ef09b33',
              'curl -X POST https://portainer.spaceriders.io/api/webhooks/d2527c89-bcae-41da-93e7-c3519ddf9400',

            ]},
          },
        }),
        environment: {
          buildImage: cb.LinuxBuildImage.STANDARD_4_0,
          privileged: true,
        },
      }
    );
    
    apipipeline.addStage({
      stageName: "Deploy-Mainnet",
      actions: [
        new cpa.ManualApprovalAction({
          actionName: "Approve",
          runOrder: 1,
        }),


        new cpa.CodeBuildAction({
          actionName: "Build",
          project: apiProdBuildProject,
          input: apisourceOutput,
          environmentVariables: {
            REGISTRY: { value: ecrRepository.repositoryUri },
          },
        }),



      ],
    });


    ecrRepository.grantPullPush(apibuildProject);
    ecrRepository.grantPullPush(apiProdBuildProject);
    

    new route53.ARecord(this, "mainnet-domain", {
      zone: sprDomain,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
    });

    new route53.ARecord(this, "testnet-domain", {
      zone: sprDomain,
      target: route53.RecordTarget.fromAlias(
        new targets.BucketWebsiteTarget(spaTestnetBucket)
      ),
      recordName: "testnet",
    });
  }
}

module.exports = { SpaceridersCdkStack };
