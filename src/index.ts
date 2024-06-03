import {
	createPimlicoBundlerClient,
	createPimlicoPaymasterClient,
} from "permissionless/clients/pimlico";
import { http, createPublicClient, Hash } from "viem";
import {
	ENTRYPOINT_ADDRESS_V07,
	createSmartAccountClient,
} from "permissionless";
import { privateKeyToSimpleSmartAccount } from "permissionless/accounts";
import { generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getUserOperationHash } from "permissionless/utils";

const chain = baseSepolia;

const publicClient = createPublicClient({
	transport: http("https://84532.rpc.thirdweb.com"),
	chain,
	pollingInterval: 50,
});

const bundlerTransport = http(
	`https://api-staging.pimlico.io/v2/${chain.id}/rpc?apikey=${process.env.PIMLICO_KEY}`,
);

const paymasterClient = createPimlicoPaymasterClient({
	chain,
	transport: bundlerTransport,
	entryPoint: ENTRYPOINT_ADDRESS_V07,
});

const bundlerClient = createPimlicoBundlerClient({
	transport: bundlerTransport,
	chain,
	entryPoint: ENTRYPOINT_ADDRESS_V07,
});

const setupSmartAccount = async () => {
	const simpleAccount = await privateKeyToSimpleSmartAccount(publicClient, {
		privateKey: generatePrivateKey(),
		entryPoint: ENTRYPOINT_ADDRESS_V07,
		factoryAddress: "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
	});

	const smartAccount = createSmartAccountClient({
		account: simpleAccount,
		chain,
		bundlerTransport,
		middleware: {
			gasPrice: async () => {
				return (await bundlerClient.getUserOperationGasPrice()).fast;
			},
			sponsorUserOperation: paymasterClient.sponsorUserOperation,
		},
	});

	let op = await smartAccount.prepareUserOperationRequest({
		userOperation: {
			callData: await smartAccount.account.encodeCallData({
				to: "0x0000000000000000000000000000000000000000",
				value: 0n,
				data: "0x",
			}),
		},
	});
	op.signature = await smartAccount.account.signUserOperation(op);

	return op;
};

const confirmedHashes = async (hashes: Hash[]) => {
	console.log(`hashes: ${hashes}`);
	await new Promise((resv) => setTimeout(resv, 10000));

	const promises = hashes.map((hash) =>
		bundlerClient.getUserOperationReceipt({ hash }),
	);

	const statuses = await Promise.all(promises);

	let successCount = 0;
	let failureCount = 0;

	statuses.forEach((status) => {
		console.log({ ...status, logs: undefined });
		if (status && status.success) {
			successCount++;
		} else {
			failureCount++;
		}
	});

	console.log(
		`Successful operations: ${successCount}, Failed operations: ${failureCount}`,
	);
};

const main = async () => {
	console.log("starting");

	const createOps = async (length: number) =>
		Promise.all(Array.from({ length }, () => setupSmartAccount()));

	const opsToSend = await createOps(5);
	const opHashes: Hash[] = [];

	let blockCounter = 0; // Counter to track the number of blocks received

	publicClient.watchBlockNumber({
		onBlockNumber: async (_blockNumber: bigint) => {
			blockCounter++; // Increment the block counter

			if (blockCounter === 1) {
				console.log("Skipping first block...");
				return; // Skip the first block
			} else if (blockCounter === 2) {
				while (true) {
					const randomWaitTime = Math.floor(Math.random() * 50);
					await new Promise((resolve) => setTimeout(resolve, randomWaitTime));

					const op = opsToSend.pop();

					if (op === undefined) {
						break;
					}

					const hash = getUserOperationHash({
						userOperation: op,
						chainId: baseSepolia.id,
						entryPoint: ENTRYPOINT_ADDRESS_V07,
					});

					opHashes.push(hash);
					bundlerClient.sendUserOperation({ userOperation: op });
				}

				await confirmedHashes(opHashes);
				process.exit(0);
			}
		},
	});
};

main();
