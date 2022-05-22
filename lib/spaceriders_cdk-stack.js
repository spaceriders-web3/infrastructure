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

  createDbInstance(id, name, secret, vpc) {
    return new rds.DatabaseInstance(this, id, {
      databaseName: name,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_19,
      }),
      // optional, defaults to m5.large
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE2,
        ec2.InstanceSize.MICRO
      ),
      credentials: rds.Credentials.fromSecret(secret, "root"),
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      publiclyAccessible: true,
    });
  }

  createLb(id, vpc, internetFacing) {
    return new elb.ApplicationLoadBalancer(this, id, {
      vpc,
      internetFacing: internetFacing,      
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
      "arn:aws:acm:eu-west-1:657117221658:certificate/1c2185f9-340e-48ba-ac67-0d9829317064"
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

  getTestnetContainerEnvironmentVariables(rdsInstance) {
    return {
      ENV: "testnet",
      DB_HOST: rdsInstance.dbInstanceEndpointAddress,
      DB_NAME: "testnet_spaceriders",
      PUBLIC_KEY: "0xbE3BdDb0a6D51DCF64AB3514795713204f58b1ea",
      CHAIN_ID: "0x61",
      CHAIN_NAME: "BSC Testnet",
      RPCS_URL: "https://data-seed-prebsc-1-s1.binance.org:8545/,https://data-seed-prebsc-2-s1.binance.org:8545/,https://data-seed-prebsc-1-s2.binance.org:8545/,https://data-seed-prebsc-2-s2.binance.org:8545/,https://data-seed-prebsc-1-s3.binance.org:8545/,https://data-seed-prebsc-2-s3.binance.org:8545/",
      ROUTER_CONTRACT: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",
      API_ENDPOINT: "http://api.spaceriders.io:81"
    }
  }

  constructor(scope, id, props) {
    //@TODO: lower Deregistration Delay -  in LB
    super(scope, id, props);
    

    const vpc = this.createVpc("MainVPC");
    const certificate = this.sprCertificate();

    const MainnetCluster = this.createEcsCluster("MainnetCluster", vpc);
    const TestnetCluster = this.createEcsCluster("TestnetCluster", vpc);

    const dbPass = this.createSsmSecret(
      "db-passs",
      '{"username": "root","password": "password"}'
    );

    const rdsInstance = this.createDbInstance(
      "spaceriders-db",
      "spaceriders",
      dbPass,
      vpc
    );
    

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

    const privateKeySecret = this.createSsmSecret(
      "private-key",
      "934a61e49cdf8fdf94230b6a451bfa1cbc6c00dec5da6114c37af8ebc0619e2d"
    );

    const lb = this.createLb("lb1", vpc, true);

    const mainnetApi = new ecs.FargateTaskDefinition(this, "MainnetApiTaskDef");
    mainnetApi.addContainer("spr-api", {
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      containerName: "spaceriders-api",
      environment: {
        ENV: "mainnet",
        DB_HOST: rdsInstance.dbInstanceEndpointAddress,
        DB_NAME: "spaceriders",
        PUBLIC_KEY: "0xbE3BdDb0a6D51DCF64AB3514795713204f58b1ea",
        CHAIN_ID: "0x61",
        CHAIN_NAME: "BSC Testnet",
        RPC_URL: "https://data-seed-prebsc-1-s1.binance.org:8545/",
        ROUTER_CONTRACT: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",
        API_ENDPOINT: "http://api.spaceriders.io"
      },
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
        DB_USER: ecs.Secret.fromSecretsManager(dbPass, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbPass, "password"),
      },
      portMappings: [
        {
          containerPort: 8000,
        },
      ],
      memoryLimitMiB: 256,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "spr-api-prod" }),
    });

    const testnetApi = new ecs.FargateTaskDefinition(this, "TestnetApiTaskDef", {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    testnetApi.addContainer("spr-api", {
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      containerName: "spaceriders-api",
      environment: this.getTestnetContainerEnvironmentVariables(rdsInstance),
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
        DB_USER: ecs.Secret.fromSecretsManager(dbPass, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbPass, "password"),
      },
      portMappings: [
        {
          containerPort: 8000,
        },
      ],
      //memoryLimitMiB: 2048,
      //cpu: 1024,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "spr-api-prod" }),
    });

    [mainnetApi, testnetApi].forEach((s) => {
      s.addToExecutionRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["ecr:*"],
          resources: ["*"],
        })
      );
    });

    const apiFargateServiceMainnet = new ecs.FargateService(
      this,
      "SprMainnetApiService",
      {
        cluster: MainnetCluster,
        taskDefinition: mainnetApi,
        desiredCount: 1,
        assignPublicIp: true,
      }
    );

    const apiFargateServiceTestnet = new ecs.FargateService(
      this,
      "SprTestnetApiService",
      {
        cluster: TestnetCluster,
        taskDefinition: testnetApi,
        desiredCount: 1,
        //assignPublicIp: true,
      }
    );

    const mainnetTg = new elb.ApplicationTargetGroup(
      this,
      "mainnetTargetGroup",
      {
        targets: [apiFargateServiceMainnet],
        deregistrationDelay: cdk.Duration.seconds(10),
        protocol: elb.ApplicationProtocol.HTTP,
        vpc: vpc,
        healthCheck: {
          path: "/health",
          port: "8000",
        },
      }
    );

    const testnetTg = new elb.ApplicationTargetGroup(
      this,
      "testnetTargetGroup",
      {
        targets: [apiFargateServiceTestnet],
        deregistrationDelay: cdk.Duration.seconds(10),
        protocol: elb.ApplicationProtocol.HTTP,
        vpc: vpc,
        healthCheck: {
          path: "/health",
          port: "8000",
        },
      }
    );

    const mainnetListener = lb.addListener("MainnetListener", {
      port: 80,      
    });

    const mainnetListenerSsl = lb.addListener("MainnetListenerSsl", {
      port: 443,
      certificates: [this.apiSprCertificate()],
      protocol: elb.ApplicationProtocol.HTTPS
    });

    const testnetListener = lb.addListener("TestnetListener", {
      port: 81,
      protocol: elb.ApplicationProtocol.HTTP,
    });

    mainnetListenerSsl.addTargetGroups("MainnetTargetGroup", {
      targetGroups: [mainnetTg],
    });

    mainnetListener.addTargetGroups("MainnetTargetGroup", {
      targetGroups: [mainnetTg],
    });

    testnetListener.addTargetGroups("TestnetTargetGroup", {
      targetGroups: [testnetTg],
    });

    const apiServiceProdScaling = apiFargateServiceMainnet.autoScaleTaskCount({
      maxCapacity: 2,
    });

    apiServiceProdScaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
    
    apiServiceProdScaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    apiFargateServiceTestnet.autoScaleTaskCount({
      maxCapacity: 1,
    });
    
    [apiFargateServiceMainnet, apiFargateServiceTestnet].forEach((s) => {
      s.connections.allowTo(
        rdsInstance,
        ec2.Port.tcp(3306),
        "RDS Instance traffic"
      );
    });

    new route53.ARecord(this, "apiRecord", {
      zone: sprDomain,
      target: route53.RecordTarget.fromAlias(
        new targets.LoadBalancerTarget(lb)
      ),
      recordName: "api",
    });

    const testnetSchedulesAsteroid = new ecs.FargateTaskDefinition(this, "TestnetSchedulesAsteroidTaskDef");
    testnetSchedulesAsteroid.addContainer("asteroid", {
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      
      containerName: "spaceriders-asteroid-collision",
      environment: this.getTestnetContainerEnvironmentVariables(rdsInstance),
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
        DB_USER: ecs.Secret.fromSecretsManager(dbPass, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbPass, "password"),
      },
      command: ["command","asteroid_collision"],
      memoryLimitMiB: 256,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "spr-testnet-asteroid" }),
    });
    
    testnetSchedulesAsteroid.addToExecutionRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ecr:*"],
      resources: ["*"],
    }));

    const cronRdsSg = new ec2.SecurityGroup(this, `cronRdsSg`, {
      vpc: vpc,
      allowAllOutbound: true,
    });
    
    cronRdsSg.connections.allowTo(
      rdsInstance,
      ec2.Port.tcp(3306),
      "RDS Instance traffic"
    );
    
    new e.Rule(this, "Rule", {
      description: "Testnet Asteroid cron",
      enabled: true,
      schedule: aas.Schedule.rate(cdk.Duration.hours(24)),
      targets: [
        new et.EcsTask({
          cluster: TestnetCluster,
          taskDefinition: testnetSchedulesAsteroid,
          securityGroups: [cronRdsSg],
        }) 
      ],
    });

    const testnetResourcePriceExchange = new ecs.FargateTaskDefinition(this, "TestnetResourcePriceExchangeTaskDef");
    testnetResourcePriceExchange.addContainer("resource_exchange", {
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      
      containerName: "spaceriders-resource-price",
      environment: this.getTestnetContainerEnvironmentVariables(rdsInstance),
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
        DB_USER: ecs.Secret.fromSecretsManager(dbPass, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbPass, "password"),
      },
      command: ["command","resource_exchange"],
      memoryLimitMiB: 256,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "spr-testnet-resource-price" }),
    });

    testnetResourcePriceExchange.addToExecutionRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ecr:*"],
      resources: ["*"],
    }));

    const cronResourceRdsSg = new ec2.SecurityGroup(this, `cronResourceRdsSg`, {
      vpc: vpc,
      allowAllOutbound: true,
    });
    
    cronResourceRdsSg.connections.allowTo(
      rdsInstance,
      ec2.Port.tcp(3306),
      "RDS Instance traffic"
    );
    
    new e.Rule(this, "RulePriceCron", {
      description: "Testnet Resource Price cron",
      enabled: true,
      schedule: aas.Schedule.rate(cdk.Duration.hours(6)),
      targets: [
        new et.EcsTask({
          cluster: TestnetCluster,
          taskDefinition: testnetResourcePriceExchange,
          securityGroups: [cronResourceRdsSg],
        }) 
      ],
    });

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
          repo: "spaceriders_frontend",
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
            BASE_API_PATH: { value: "http://api.spaceriders.io:81" },
            ENV: {value: "testnet"},
            GA_MEASUREMENT_ID: {value: "G-D1B6V8LGPL"}
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
            BASE_API_PATH: { value: "https://api.spaceriders.io" },
            ENV: {value: "mainnet"},
            GA_MEASUREMENT_ID: {value: "G-CXNZDQ8FKK"}
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
      repo: "spaceriders_api",
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

    const imgDef = new cp.Artifact();
    apipipeline.addStage({
      stageName: "Build",
      actions: [
        new cpa.CodeBuildAction({
          outputs: [imgDef],
          actionName: "Build",
          project: apibuildProject,
          input: apisourceOutput,
          environmentVariables: {
            REGISTRY: { value: ecrRepository.repositoryUri },
          },
        }),
      ],
    });
    
    ecrRepository.grantPullPush(apibuildProject);

    apipipeline.addStage({
      stageName: "Deploy-Testnet",
      actions: [
        new cpa.EcsDeployAction({
          actionName: "Deploy-Testnet",
          service: apiFargateServiceTestnet,
          input: imgDef,
          deploymentTimeout: cdk.Duration.minutes(15),
        }),
      ],
    });

    apipipeline.addStage({
      stageName: "Deploy-Mainnet",
      actions: [
        new cpa.ManualApprovalAction({
          actionName: "Approve",
          runOrder: 1,
        }),

        new cpa.EcsDeployAction({
          actionName: "Deploy-Mainnet",
          service: apiFargateServiceMainnet,
          input: imgDef,
          deploymentTimeout: cdk.Duration.minutes(15),
          runOrder: 2,
        }),
      ],
    });

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
