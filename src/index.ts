import path from 'node:path';
import * as digitalocean from '@pulumi/digitalocean';
import * as kubernetes from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const minNodeCount = config.getNumber('minNodeCount') ?? 1;
const maxNodeCount = config.getNumber('maxNodeCount') ?? 5;

const cluster = new digitalocean.KubernetesCluster('do-cluster', {
	region: digitalocean.Region.BLR1,
	version: '1.25.4-do.0',
	nodePool: {
		name: 'default',
		size: digitalocean.DropletSlug.DropletS1VCPU2GB,
		autoScale: true,
		minNodes: minNodeCount,
		maxNodes: maxNodeCount,
	},
});

const kubeconfig = cluster.status.apply(status => {
	if (status === 'running') {
		const clusterDataSource = cluster.name.apply(async name => digitalocean.getKubernetesCluster({name}));

		return clusterDataSource.kubeConfigs[0].rawConfig;
	}

	return cluster.kubeConfigs[0].rawConfig;
});

const provider = new kubernetes.Provider('do-k8s', {kubeconfig});
const app = 'argocd';

const chartNamespace = new kubernetes.core.v1.Namespace(
	app,
	{
		metadata: {name: app},
	},
	{
		provider,
	},
);

const doConfig = new pulumi.Config('digitalocean');
const doCreds = doConfig.getSecret('token') ?? 'digitalocean:token';
const githubUsername = config.getSecret('githubUsername') ?? 'githubUsername';
const githubPassword = config.getSecret('githubPassword') ?? 'githubPassword';
const argocdAdminPasswordBcryptHash = config.getSecret('argocdAdminPasswordBcryptHash') ?? 'argocdAdminPasswordBcryptHash';
const domain = config.getSecret('domain') ?? 'domain';
const repoUrl = config.getSecret('repoUrl') ?? 'repoUrl';
const mailgunAuthPass = config.getSecret('mailgunAuthPass') ?? 'mailgunAuthPass';
const doAccessKeyId = config.getSecret('doAccessKeyId') ?? 'doAccessKeyId';
const doSecretAccessKey = config.getSecret('doSecretAccessKey') ?? 'doSecretAccessKey';
const doBucket = config.getSecret('doBucket') ?? 'doBucket';
const s3Endpoint = config.getSecret('s3Endpoint') ?? 's3Endpoint';

const chartValues = {
	githubUsername,
	githubPassword,
	argocdAdminPasswordBcryptHash,
	doCreds,
	domain,
	repoUrl,
	mailgunAuthPass,
	doAccessKeyId,
	doSecretAccessKey,
	doBucket,
	s3Endpoint,
};

Reflect.construct(kubernetes.helm.v3.Chart, [
	app,
	{
		namespace: chartNamespace.metadata.name,
		// eslint-disable-next-line unicorn/prefer-module
		path: path.join(__dirname, '..', app),
		values: chartValues,
	},
	{
		provider,
	},
]);

type Secret = {
	metadata: {
		name: string;
	};
	data?: Record<string, string | pulumi.Output<string>>;
	stringData?: Record<string, string | pulumi.Output<string>>;
};

Reflect.construct(kubernetes.yaml.ConfigGroup, ['do-db-operator', {
	files: 'https://raw.githubusercontent.com/digitalocean/do-operator/main/releases/do-operator-v0.1.5.yaml',
	transformations: [((secret: Secret) => {
		if (secret.metadata.name === 'do-operator-do-api-token') {
			delete secret.data;
			secret.stringData = {'access-token': doCreds};
			return secret;
		}

		return secret;
	})],
}, {
	provider,
}]);
