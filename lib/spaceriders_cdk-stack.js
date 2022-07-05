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

  constructor(scope, id, props) {
    //@TODO: Use ec2 ecs cluster: https://stackoverflow.com/questions/36462657/how-to-register-ec2-instance-to-ecs-cluster
    
    //@TODO: https://docs.aws.amazon.com/cdk/api/v1/docs/aws-ecs-readme.html
    //@TODO: https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.AddCapacityOptions.html
    
    //@TODO: https://stackoverflow.com/a/64215125
    super(scope, id, props);

    const vpc = this.createVpc("MainVPC");
    const certificate = this.sprCertificate();

    const MainnetCluster = this.createEcsCluster("MainnetCluster", vpc);
    const TestnetCluster = this.createEcsCluster("TestnetCluster", vpc);
    
    TestnetCluster.addCapacity('TestnetAutoScalingGroupCapacity', {
      instanceType: new ec2.InstanceType("c5a.large"),
      desiredCapacity: 1,
      machineImage: new ecs.BottleRocketImage(),
    });

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

    const privateKeySecret = this.createSsmSecret(
      "private-key",
      "934a61e49cdf8fdf94230b6a451bfa1cbc6c00dec5da6114c37af8ebc0619e2d"
    );

    const lb = this.createLb("lb1", vpc, true);
/*
    const mainnetApi = new ecs.FargateTaskDefinition(this, "MApi");
    mainnetApi.addContainer("api", {
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      containerName: "api",
      environment: {
        TIMEOUT: "600",
        ENV: "testnet",
        DB_URL: `mongodb+srv://spaceriders_mainnet:vYEmeIwjiGmCcJtE@cluster0.svram.mongodb.net/`,
        DB_NAME: "spaceriders_mainnet",
        SECRET_KEY: "9y$B&E)H@McQfTjWnZr4u7x!A%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3",
        LOG_LEVEL: "INFO",

        CACHE_DRIVER: "memcache",
        CACHE_HOST: "spr-cache.e5vsvm.0001.euw1.cache.amazonaws.com",
        CACHE_PORT: "11211",

        PUBLIC_KEY: "0xbE3BdDb0a6D51DCF64AB3514795713204f58b1ea",
        RPCS_URL_MAINNET: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: "0x61",
        CHAIN_NAME: "BSC Testnet",
        RPCS_URL: "https://data-seed-prebsc-1-s1.binance.org:8545/,https://data-seed-prebsc-2-s1.binance.org:8545/,https://data-seed-prebsc-1-s2.binance.org:8545/,https://data-seed-prebsc-2-s2.binance.org:8545/,https://data-seed-prebsc-1-s3.binance.org:8545/,https://data-seed-prebsc-2-s3.binance.org:8545/",
        ROUTER_CONTRACT: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",
        API_ENDPOINT: "http://api.spaceriders.io",

        PLANET_IMAGES_BUCKET_PATH: "https://spaceriders-planet-images.s3.eu-west-1.amazonaws.com",
        TESTNET_TICKET_IMAGES_BUCKET_PATH: "https://spaceriders-testnet-ticket.s3.eu-west-1.amazonaws.com"
      },
      entryPoint: ["gunicorn", "-w", "4", "--threads", "2", "-k", "uvicorn.workers.UvicornWorker", "--timeout", "600", "--bind", "0.0.0.0:8000", "apps.http.__init__:app"],
      workingDirectory: "/app/src",
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
      },
      portMappings: [
        {
          containerPort: 8000,
        },
      ],
      memoryLimitMiB: 256,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "api-prod" }),
    });


    const mainnetApiCronjobs = new ecs.FargateTaskDefinition(this, "MApiCronjob", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    const mainnetApiCronjobContainer = mainnetApiCronjobs.addContainer("cronjobs", {
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      containerName: "cronjobs",
      environment: {
        TIMEOUT: "600",
        ENV: "testnet",
        DB_URL: `mongodb+srv://spaceriders_mainnet:vYEmeIwjiGmCcJtE@cluster0.svram.mongodb.net/`,
        DB_NAME: "spaceriders_mainnet",
        SECRET_KEY: "9y$B&E)H@McQfTjWnZr4u7x!A%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3",
        LOG_LEVEL: "INFO",

        CACHE_DRIVER: "memcache",
        CACHE_HOST: "spr-cache.e5vsvm.0001.euw1.cache.amazonaws.com",
        CACHE_PORT: "11211",

        PUBLIC_KEY: "0xbE3BdDb0a6D51DCF64AB3514795713204f58b1ea",
        RPCS_URL_MAINNET: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: "0x61",
        CHAIN_NAME: "BSC Testnet",
        RPCS_URL: "https://data-seed-prebsc-1-s1.binance.org:8545/,https://data-seed-prebsc-2-s1.binance.org:8545/,https://data-seed-prebsc-1-s2.binance.org:8545/,https://data-seed-prebsc-2-s2.binance.org:8545/,https://data-seed-prebsc-1-s3.binance.org:8545/,https://data-seed-prebsc-2-s3.binance.org:8545/",
        ROUTER_CONTRACT: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",
        API_ENDPOINT: "http://api.spaceriders.io",

        PLANET_IMAGES_BUCKET_PATH: "https://spaceriders-planet-images.s3.eu-west-1.amazonaws.com",
        TESTNET_TICKET_IMAGES_BUCKET_PATH: "https://spaceriders-testnet-ticket.s3.eu-west-1.amazonaws.com"
      },
      entryPoint: ["python", "-m", "apps.cronjobs.__init__"],
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
      },
      portMappings: [
      ],
      //memoryLimitMiB: 2048,
      //cpu: 1024,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "cronjobs-testnet" }),
    });
*/
    /*mainnetApiCronjobContainer.addUlimits({
      hardLimit: 1048576,
      softLimit: 1048576,
      name: ecs.UlimitName.NOFILE,
    })*/

    const testnetApi = new ecs.Ec2TaskDefinition(this, "TApi");
    
    // https://medium.com/building-the-system/gunicorn-3-means-of-concurrency-efbb547674b7
    // https://stackoverflow.com/a/59183741/2254192
    const testnetApiContainer = testnetApi.addContainer("api", {
      memoryLimitMiB: 1024,
      cpu: 512, // 1vCPU
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      containerName: "api",
      environment: {
        TIMEOUT: "600",
        ENV: "testnet",
        //DB_URL: `mongodb://spr:spr_password@sprdbmongo45760d76-pqebhg876v2s.cluster-cch2nm8vz0as.eu-west-1.docdb.amazonaws.com:27017`,
        //DB_URL: `mongodb://sprdbmongo45760d76-pqebhg876v2s.cluster-cch2nm8vz0as.eu-west-1.docdb.amazonaws.com:27017`,
        DB_URL: `mongodb+srv://spaceriders_testnet:ia7EH1Itja8fIvyb@cluster0.svram.mongodb.net/`,
        DB_NAME: "spaceriders_testnet",
        SECRET_KEY: "9y$B&E)H@McQfTjWnZr4u7x!A%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3",
        LOG_LEVEL: "INFO",

        CACHE_DRIVER: "memcache",
        CACHE_HOST: "spr-cache.e5vsvm.0001.euw1.cache.amazonaws.com",
        CACHE_PORT: "11211",

        PUBLIC_KEY: "0xbE3BdDb0a6D51DCF64AB3514795713204f58b1ea",
        RPCS_URL_MAINNET: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: "0x61",
        CHAIN_NAME: "BSC Testnet",
        RPCS_URL: "https://data-seed-prebsc-1-s1.binance.org:8545/,https://data-seed-prebsc-2-s1.binance.org:8545/,https://data-seed-prebsc-1-s2.binance.org:8545/,https://data-seed-prebsc-2-s2.binance.org:8545/,https://data-seed-prebsc-1-s3.binance.org:8545/,https://data-seed-prebsc-2-s3.binance.org:8545/",
        ROUTER_CONTRACT: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",
        API_ENDPOINT: "http://api.spaceriders.io:81",

        PLANET_IMAGES_BUCKET_PATH: "https://spaceriders-planet-images.s3.eu-west-1.amazonaws.com",
        TESTNET_TICKET_IMAGES_BUCKET_PATH: "https://spaceriders-testnet-ticket.s3.eu-west-1.amazonaws.com"
    },
    entryPoint: ["gunicorn", "-w", "3", "--threads", "4", "-k", "uvicorn.workers.UvicornWorker", "--timeout", "600", "--bind", "0.0.0.0:8000", "apps.http.__init__:app"],
    workingDirectory: "/app/src",
    secrets: {
      PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
    },
    portMappings: [
      {
        containerPort: 8000,
      },
    ],

      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "api-testnet" }),
    });

    testnetApiContainer.addUlimits({
      hardLimit: 1048576,
      softLimit: 1048576,
      name: ecs.UlimitName.NOFILE,
    })


    const testnetWebsocket = new ecs.Ec2TaskDefinition(this, "TWSApp");
    
    // https://medium.com/building-the-system/gunicorn-3-means-of-concurrency-efbb547674b7
    // https://stackoverflow.com/a/59183741/2254192
    const websocketApiContainer = testnetWebsocket.addContainer("wsapp", {
      memoryLimitMiB: 512,
      cpu: 512, // 1vCPU
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      containerName: "api",
      environment: {
        TIMEOUT: "600",
        ENV: "testnet",
        //DB_URL: `mongodb://spr:spr_password@sprdbmongo45760d76-pqebhg876v2s.cluster-cch2nm8vz0as.eu-west-1.docdb.amazonaws.com:27017`,
        //DB_URL: `mongodb://sprdbmongo45760d76-pqebhg876v2s.cluster-cch2nm8vz0as.eu-west-1.docdb.amazonaws.com:27017`,
        DB_URL: `mongodb+srv://spaceriders_testnet:ia7EH1Itja8fIvyb@cluster0.svram.mongodb.net/`,
        DB_NAME: "spaceriders_testnet",
        SECRET_KEY: "9y$B&E)H@McQfTjWnZr4u7x!A%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3",
        LOG_LEVEL: "INFO",

        CACHE_DRIVER: "memcache",
        CACHE_HOST: "spr-cache.e5vsvm.0001.euw1.cache.amazonaws.com",
        CACHE_PORT: "11211",

        PUBLIC_KEY: "0xbE3BdDb0a6D51DCF64AB3514795713204f58b1ea",
        RPCS_URL_MAINNET: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: "0x61",
        CHAIN_NAME: "BSC Testnet",
        RPCS_URL: "https://data-seed-prebsc-1-s1.binance.org:8545/,https://data-seed-prebsc-2-s1.binance.org:8545/,https://data-seed-prebsc-1-s2.binance.org:8545/,https://data-seed-prebsc-2-s2.binance.org:8545/,https://data-seed-prebsc-1-s3.binance.org:8545/,https://data-seed-prebsc-2-s3.binance.org:8545/",
        ROUTER_CONTRACT: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",
        API_ENDPOINT: "http://api.spaceriders.io:81",

        PLANET_IMAGES_BUCKET_PATH: "https://spaceriders-planet-images.s3.eu-west-1.amazonaws.com",
        TESTNET_TICKET_IMAGES_BUCKET_PATH: "https://spaceriders-testnet-ticket.s3.eu-west-1.amazonaws.com"
    },
    entryPoint: ["gunicorn", "-w", "3", "--threads", "4", "-k", "uvicorn.workers.UvicornWorker", "--timeout", "600", "--bind", "0.0.0.0:8001", "apps.websockets.__init__:app"],
    workingDirectory: "/app/src",
    secrets: {
      PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
    },
    portMappings: [
      {
        containerPort: 8001,
      },
    ],

      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "api-testnet" }),
    });

    websocketApiContainer.addUlimits({
      hardLimit: 1048576,
      softLimit: 1048576,
      name: ecs.UlimitName.NOFILE,
    })

    const testnetApiCronjobs = new ecs.Ec2TaskDefinition(this, "TApiCronjob", {

      //placementConstraints
    });


    testnetApiCronjobs.addContainer("cronjobs", {
      memoryLimitMiB: 512,
      cpu: 512, // 1vCPU
      
      image: ecs.ContainerImage.fromRegistry(
        `657117221658.dkr.ecr.eu-west-1.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
      containerName: "cronjobs",
      environment: {
        TIMEOUT: "600",
        ENV: "testnet",
        //DB_URL: `mongodb://spr:spr_password@sprdbmongo45760d76-pqebhg876v2s.cluster-cch2nm8vz0as.eu-west-1.docdb.amazonaws.com:27017`,
        //DB_URL: `mongodb://sprdbmongo45760d76-pqebhg876v2s.cluster-cch2nm8vz0as.eu-west-1.docdb.amazonaws.com:27017`,
        DB_URL: `mongodb+srv://spaceriders_testnet:ia7EH1Itja8fIvyb@cluster0.svram.mongodb.net/`,
        DB_NAME: "spaceriders_testnet",
        SECRET_KEY: "9y$B&E)H@McQfTjWnZr4u7x!A%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3",
        LOG_LEVEL: "INFO",

        CACHE_DRIVER: "memcache",
        CACHE_HOST: "spr-cache.e5vsvm.0001.euw1.cache.amazonaws.com",
        CACHE_PORT: "11211",

        PUBLIC_KEY: "0xbE3BdDb0a6D51DCF64AB3514795713204f58b1ea",
        RPCS_URL_MAINNET: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: "0x61",
        CHAIN_NAME: "BSC Testnet",
        RPCS_URL: "https://data-seed-prebsc-1-s1.binance.org:8545/,https://data-seed-prebsc-2-s1.binance.org:8545/,https://data-seed-prebsc-1-s2.binance.org:8545/,https://data-seed-prebsc-2-s2.binance.org:8545/,https://data-seed-prebsc-1-s3.binance.org:8545/,https://data-seed-prebsc-2-s3.binance.org:8545/",
        ROUTER_CONTRACT: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",
        API_ENDPOINT: "http://api.spaceriders.io:81",

        PLANET_IMAGES_BUCKET_PATH: "https://spaceriders-planet-images.s3.eu-west-1.amazonaws.com",
        TESTNET_TICKET_IMAGES_BUCKET_PATH: "https://spaceriders-testnet-ticket.s3.eu-west-1.amazonaws.com"
      },
      entryPoint: ["python", "-m", "apps.cronjobs.__init__"],
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(privateKeySecret),
      },
      portMappings: [
      ],
      //memoryLimitMiB: 2048,
      //cpu: 1024,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "cronjobs-testnet" }),
    });

    [/*mainnetApi, mainnetApiCronjobs*/, testnetApi, testnetApiCronjobs, testnetWebsocket].forEach((s) => {
      s.addToExecutionRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["ecr:*"],
          resources: ["*"],
        })
      );
    });
/*
    const apiFargateServiceMainnet = new ecs.FargateService(
      this,
      "ApiServiceMainnet",
      {
        cluster: MainnetCluster,
        taskDefinition: mainnetApi,
        desiredCount: 1,
        assignPublicIp: true,
      }
    );

    const cronjobFargateServiceMainnet = new ecs.FargateService(
      this,
      "CronjobServiceMainnet",
      {
        cluster: MainnetCluster,
        taskDefinition: mainnetApiCronjobs,
        desiredCount: 1,
        //assignPublicIp: true,
      }
    );
*/
    const apiFargateServiceTestnet = new ecs.Ec2Service(
      this,
      "ApiServiceTestnet",
      {
        cluster: TestnetCluster,
        taskDefinition: testnetApi,
        desiredCount: 1,
        
        //assignPublicIp: true,
      }
    );

    const apiServiceTestnetScaling = apiFargateServiceTestnet.autoScaleTaskCount({
      maxCapacity: 2,
    });

    apiServiceTestnetScaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 75,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });
    
    apiServiceTestnetScaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 90,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });

    const cronjobFargateServiceTestnet = new ecs.Ec2Service(
      this,
      "CronjobServiceTestnet",
      {
        cluster: TestnetCluster,
        taskDefinition: testnetApiCronjobs,
        desiredCount: 1,
        //assignPublicIp: true,
      }
    );

    const websocketServiceTestnet = new ecs.Ec2Service(
      this,
      "WebsocketServiceTestnet",
      {
        cluster: TestnetCluster,
        taskDefinition: testnetWebsocket,
        desiredCount: 1,
        //assignPublicIp: true,
      }
    );
  
/*
    const mainnetTg = new elb.ApplicationTargetGroup(
      this,
      "mainnetTargetGroup",
      {
        targets: [apiFargateServiceMainnet],
        deregistrationDelay: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(600),
        protocol: elb.ApplicationProtocol.HTTP,
        vpc: vpc,
        healthCheck: {
          path: "/health",
          port: "8000",
        },
      }
    );
*/  

    const websocketTg = new elb.ApplicationTargetGroup(
      this,
      "websocketTestnetTargetGroup",
      {
        targets: [websocketServiceTestnet],
        deregistrationDelay: cdk.Duration.seconds(10),
        protocol: elb.ApplicationProtocol.HTTP,
        stickinessCookieDuration: cdk.Duration.hours(1),
        vpc: vpc,
        port: 8001,
        healthCheck: {
          path: "/health",
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
        stickinessCookieDuration: cdk.Duration.hours(1),
        vpc: vpc,
        port: 8000,
        healthCheck: {
          path: "/health",
        },
      }
    );
/*
    const mainnetListener = lb.addListener("MainnetListener", {
      port: 80,      
    });

    const mainnetListenerSsl = lb.addListener("MainnetListenerSsl", {
      port: 443,
      certificates: [this.apiSprCertificate()],
      protocol: elb.ApplicationProtocol.HTTPS
    });
*/
    const testnetListener = lb.addListener("TestnetListener", {
      port: 81,
      protocol: elb.ApplicationProtocol.HTTP,
    });

    const websocketListener = lb.addListener("WSTestnetListener", {
      port: 82,
      protocol: elb.ApplicationProtocol.HTTP,
    });
/*
    mainnetListenerSsl.addTargetGroups("MainnetTargetGroup", {
      targetGroups: [mainnetTg],
    });

    mainnetListener.addTargetGroups("MainnetTargetGroup", {
      targetGroups: [mainnetTg],
    });
*/
    testnetListener.addTargetGroups("TestnetTargetGroup", {
      targetGroups: [testnetTg],
    });

    websocketListener.addTargetGroups("WsTestnetTargetGroup", {
      targetGroups: [websocketTg],
    });
/*
    const apiServiceProdScaling = apiFargateServiceMainnet.autoScaleTaskCount({
      maxCapacity: 2,
    });

    apiServiceProdScaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 49,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
    
    apiServiceProdScaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 49,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
*/

    new route53.ARecord(this, "apiRecord", {
      zone: sprDomain,
      target: route53.RecordTarget.fromAlias(
        new targets.LoadBalancerTarget(lb)
      ),
      recordName: "api",
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
            BASE_WS_PATH: {value: "ws://api.spaceriders.io:82/ws"},
            ENV: {value: "testnet"},
            GA_MEASUREMENT_ID: {value: "G-D1B6V8LGPL"},
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
            BASE_WS_PATH: {value: "ws://api.spaceriders.io:82/ws"},
            ENV: {value: "mainnet"},
            GA_MEASUREMENT_ID: {value: "G-CXNZDQ8FKK"},
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
      repo: "spaceriders_apiv2",
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

    const imgDef1 = new cp.Artifact("api");
    const imgDef2 = new cp.Artifact("cronjobs");
    
    apipipeline.addStage({
      stageName: "Build",
      actions: [
        new cpa.CodeBuildAction({
          outputs: [imgDef1, imgDef2],
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
          actionName: "Api",
          service: apiFargateServiceTestnet,
          //input: imgDef1,
          imageFile: imgDef1.atPath('imagedefinitions1.json'),
          deploymentTimeout: cdk.Duration.minutes(15),
        }),
        new cpa.EcsDeployAction({
          actionName: "Cronjobs",
          service: cronjobFargateServiceTestnet,
          //input: imgDef2,
          imageFile: imgDef2.atPath('imagedefinitions2.json'),
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

        /*new cpa.EcsDeployAction({
          actionName: "Api",
          service: apiFargateServiceMainnet,
          //input: imgDef1,
          imageFile: imgDef1.atPath('imagedefinitions1.json'),
          deploymentTimeout: cdk.Duration.minutes(15),
        }),
        new cpa.EcsDeployAction({
          actionName: "Cronjobs",
          service: cronjobFargateServiceMainnet,
          //input: imgDef2,
          imageFile: imgDef2.atPath('imagedefinitions2.json'),
          deploymentTimeout: cdk.Duration.minutes(15),
        }),*/
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
