import * as digitalocean from '@pulumi/digitalocean';
import * as kubernetes from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

const doConfig = new pulumi.Config('digitalocean');
const config = new pulumi.Config();
const minNodeCount = config.getNumber('minNodeCount') ?? 1;
const maxNodeCount = config.getNumber('maxNodeCount') ?? 3;

const cluster = new digitalocean.KubernetesCluster('do-cluster', {
	region: digitalocean.Region.BLR1,
	// eslint-disable-next-line unicorn/prefer-top-level-await
	version: digitalocean.getKubernetesVersions().then(p => p.latestVersion),
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

const chartValues = {
	githubUsername: config.getSecret('githubUsername') ?? 'githubUsername',
	githubPassword: config.getSecret('githubPassword') ?? 'githubPassword',
	argocdAdminPasswordBcryptHash: config.getSecret('argocdAdminPasswordBcryptHash') ?? 'argocdAdminPasswordBcryptHash',
	doCreds: doConfig.getSecret('token') ?? 'digitalocean:token',
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
