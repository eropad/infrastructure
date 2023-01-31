import * as digitalocean from '@pulumi/digitalocean';
import * as kubernetes from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const minNodeCount = config.getNumber('minNodeCount') ?? 1;
const maxNodeCount = config.getNumber('minNodeCount') ?? 1;

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
const appLabels = {app: 'app-nginx'};

Reflect.construct(kubernetes.apps.v1.Deployment, ['do-app-dep', {
	spec: {
		selector: {matchLabels: appLabels},
		template: {
			metadata: {labels: appLabels},
			spec: {
				containers: [{
					name: 'nginx',
					image: 'nginx',
				}],
			},
		},
	},
}, {provider}]);
