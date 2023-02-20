import * as digitalocean from '@pulumi/digitalocean';
import * as kubernetes from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const doConfig = new pulumi.Config('digitalocean');
const minNodeCount = config.getNumber('minNodeCount') ?? 1;
const maxNodeCount = config.getNumber('maxNodeCount') ?? 5;
const region = config.getSecret('region') ?? 'nyc3';
const ageKeys = config.getSecret('ageKeys') ?? 'ageKeys';
const doCreds = doConfig.getSecret('token') ?? 'digitalocean:token';

const cluster = new digitalocean.KubernetesCluster('do-cluster', {
	region,
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

const app = 'argocd';
const provider = new kubernetes.Provider('do-k8s', {kubeconfig});

const chartNamespace = new kubernetes.core.v1.Namespace(
	app,
	{
		metadata: {name: app},
	},
	{
		provider,
	},
);

const chartValues = {
	ageKeys,
	region,
	doCreds,
};

Reflect.construct(kubernetes.helm.v3.Chart, [
	app,
	{
		namespace: chartNamespace.metadata.name,
		path: app,
		values: chartValues,
	},
	{
		provider,
	},
]);

Reflect.construct(kubernetes.yaml.ConfigGroup, ['do-db-operator', {
	files: 'https://raw.githubusercontent.com/digitalocean/do-operator/main/releases/do-operator-v0.1.5.yaml',
	transformations: [((secret: {
		metadata: {
			name: string;
		};
		data?: Record<string, string | pulumi.Output<string>>;
		stringData?: Record<string, string | pulumi.Output<string>>;
	}) => {
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
