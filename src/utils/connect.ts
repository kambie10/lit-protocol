import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitNetwork, LIT_RPC, AuthMethodType } from "@lit-protocol/constants";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { createSiweMessageWithRecaps, generateAuthSig, LitAbility, LitActionResource, LitPKPResource } from "@lit-protocol/auth-helpers";
import { EthWalletProvider, LitAuthClient } from "@lit-protocol/lit-auth-client";
import * as ethers from "ethers";
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { LitNodeClientConfig } from "@lit-protocol/types";
import { isBytesLike } from "ethers/lib/utils";

function getWallet(privateKey: any) {
  if (privateKey !== undefined)
    return new ethers.Wallet(
      privateKey,
      new ethers.providers.JsonRpcProvider(
        LIT_RPC.CHRONICLE_YELLOWSTONE
      )
    );

  if (process.env.PRIVATE_KEY === undefined)
    throw new Error("Please provide the env: PRIVATE_KEY");

  return new ethers.Wallet(
    process.env.PRIVATE_KEY,
    new ethers.providers.JsonRpcProvider(
      LIT_RPC.CHRONICLE_YELLOWSTONE
    )
  );
}

async function getLitNodeClient() {
  const litNodeClient = new LitNodeClient({
    litNetwork: LitNetwork.DatilTest,
    debug: false,
  });

  console.log("Connecting litNodeClient to network...");
  await litNodeClient.connect();

  console.log("litNodeClient connected!");
  return litNodeClient;
}

function getAuthNeededCallback(litNodeClient: any, ethersSigner: any) {
  return async ({ resourceAbilityRequests, expiration, uri }: any) => {
    const toSign = await createSiweMessageWithRecaps({
      uri,
      expiration,
      resources: resourceAbilityRequests,
      walletAddress: await ethersSigner.getAddress(),
      nonce: await litNodeClient.getLatestBlockhash(),
      litNodeClient,
    });

    return await generateAuthSig({
      signer: ethersSigner,
      toSign,
    });
  };
}

async function getSessionSigs(litNodeClient: any, ethersSigner: any) {
  console.log("Getting Session Signatures...");
  return litNodeClient.getSessionSigs({
    chain: "ethereum",
    expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
    resourceAbilityRequests: [
      {
        resource: new LitPKPResource("*"),
        ability: LitAbility.PKPSigning,
      },
      {
        resource: new LitActionResource("*"),
        ability: LitAbility.LitActionExecution,
      },
    ],
    authNeededCallback: getAuthNeededCallback(litNodeClient, ethersSigner),
  });
}

async function genAuthSig(litNodeClient: any, ethersSigner: any) {
  const toSign = await createSiweMessageWithRecaps({
    uri: "http://localhost",
    expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
    walletAddress: await ethersSigner.getAddress(),
    nonce: await litNodeClient.getLatestBlockhash(),
    litNodeClient: litNodeClient,
  });

  return await generateAuthSig({
    signer: ethersSigner,
    toSign,
  });
}

const litActionCode = `
(async () => {
  await Lit.Actions.claimKey({keyId: userId});
})();
`;

async function claimKey(litNodeClient: any, sessionSigs: any, authSig: any, ethersSigner: any) {

  const authMethod = {
    authMethodType: AuthMethodType.EthWallet,
    accessToken: JSON.stringify(authSig),
  };

  const authMethodId = await LitAuthClient.getAuthIdByAuthMethod(authMethod);

  console.log("🔄 Connecting LitContracts client to network...");
  const litContracts = new LitContracts({
    signer: ethersSigner,
    network: LitNetwork.Datil,
    debug: false,
  });
  await litContracts.connect();
  console.log("✅ Connected LitContracts client to network");

  const res = await litNodeClient.executeJs({
    sessionSigs,
    code: litActionCode,
    jsParams: {
      userId: 'foo'
    },
  });

  let tx = await litContracts.pkpHelperContract.write.claimAndMintNextAndAddAuthMethods(
    {
      keyType: 2,
      derivedKeyId: `0x${res.claims['foo'].derivedKeyId}`,
      signatures: res.claims['foo'].signatures,
    },
   {
    keyType: 2,
    permittedIpfsCIDs: [],
    permittedIpfsCIDScopes: [],
    permittedAddresses: [],
    permittedAddressScopes: [],
    permittedAuthMethodTypes: [AuthMethodType.EthWallet],
    permittedAuthMethodIds: [authMethodId],
    permittedAuthMethodPubkeys: [`0x`],
    permittedAuthMethodScopes: [[ethers.BigNumber.from("2")]],
    addPkpEthAddressAsPermittedAddress: true,
    sendPkpToItself: true
   });

   console.log("tx", tx);

}

export const getSessionSigsPKP = async (
  pkp?: {
    tokenId: any;
    publicKey: string;
    ethAddress: string;
  },
  capacityTokenId?: string
) => {
  let litNodeClient: LitNodeClient;

  try {
    const ethersSigner = new ethers.Wallet(
      'ebeb135511bf17dd9c8d624ec7a56fe26d9059a51eda0f1623a28a8c45db4386',
      new ethers.providers.JsonRpcProvider(LIT_RPC.CHRONICLE_YELLOWSTONE)
    );

    console.log("🔄 Connecting LitNodeClient to Lit network...");
    litNodeClient = new LitNodeClient({
      litNetwork: LitNetwork.DatilTest,
      debug: false,
    });
    await litNodeClient.connect();
    console.log("✅ Connected LitNodeClient to Lit network");

    console.log("🔄 Connecting LitContracts client to network...");
    const litContracts = new LitContracts({
      signer: ethersSigner,
      network: LitNetwork.DatilTest,
      debug: false,
    });
    await litContracts.connect();
    console.log("✅ Connected LitContracts client to network");

    if (!pkp) {
      console.log("🔄 Minting new PKP...");
      pkp = (await litContracts.pkpNftContractUtils.write.mint()).pkp;
      console.log(
        `✅ Minted new PKP with public key: ${pkp.publicKey} and ETH address: ${pkp.ethAddress}`
      );
    }

    if (!capacityTokenId) {
      console.log("🔄 Minting Capacity Credits NFT...");
      capacityTokenId = (
        await litContracts.mintCapacityCreditsNFT({
          requestsPerKilosecond: 10,
          daysUntilUTCMidnightExpiration: 1,
        })
      ).capacityTokenIdStr;
      console.log(`✅ Minted new Capacity Credit with ID: ${capacityTokenId}`);
    }

    console.log("🔄 Creating capacityDelegationAuthSig...");
    const { capacityDelegationAuthSig } =
      await litNodeClient.createCapacityDelegationAuthSig({
        dAppOwnerWallet: ethersSigner,
        capacityTokenId,
        delegateeAddresses: [pkp.ethAddress],
        uses: "1",
      });
    console.log(`✅ Created the capacityDelegationAuthSig`);

    console.log("🔄 Creating AuthMethod using the ethersSigner...");
    const authMethod = await EthWalletProvider.authenticate({
      signer: ethersSigner,
      litNodeClient,
    });
    console.log("✅ Finished creating the AuthMethod");

    console.log("🔄 Getting the Session Sigs for the PKP...");
    const sessionSignatures = await litNodeClient.getPkpSessionSigs({
      pkpPublicKey: pkp.publicKey!,
      capabilityAuthSigs: [capacityDelegationAuthSig],
      authMethods: [authMethod],
      resourceAbilityRequests: [
        {
          resource: new LitPKPResource("*"),
          ability: LitAbility.PKPSigning,
        },
      ],
      expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // 10 minutes
    });
    console.log("✅ Got PKP Session Sigs", sessionSignatures);
    return sessionSignatures;
  } catch (error) {
    console.error(error);
  } finally {
    litNodeClient!.disconnect();
  }
};

export const connect = async () => {
  let sk = generateSecretKey() // `sk` is a Uint8Array
  let pk = getPublicKey(sk) // `pk` is a hex string

  let event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: 'hello',
  }, sk)
  
  let isGood = verifyEvent(event)

  console.log(event, isGood, sk, pk)
}

export const connectAndClaimKey = async () => {
  let litNodeClient

  try {
    const wallet = getWallet('ebeb135511bf17dd9c8d624ec7a56fe26d9059a51eda0f1623a28a8c45db4386')

    litNodeClient = await getLitNodeClient()

    const sessionSigs = await getSessionSigs(litNodeClient, wallet);
    console.log("Got Session Signatures!", sessionSigs)

    const authSig = await genAuthSig(litNodeClient, wallet);
    console.log("Got Auth Sig for Lit Action conditional check!", authSig)

    await claimKey(litNodeClient, sessionSigs, authSig, wallet)

  } catch (error) {
    console.log(error, 'errdsfsdf')
  } finally {
    litNodeClient.disconnect();
  }
}