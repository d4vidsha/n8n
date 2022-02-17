import express = require('express');
import { getConnection } from 'typeorm';

import { Db } from '../../src';
import { randomName, randomString } from './shared/random';
import * as utils from './shared/utils';
import type { SaveCredentialFunction } from './shared/types';

import { UserSettings } from 'n8n-core';

let app: express.Application;
let saveCredential: SaveCredentialFunction;

beforeAll(async () => {
	app = utils.initTestServer({
		namespaces: ['credentials'],
		applyAuth: true,
		externalHooks: true,
	});
	await utils.initTestDb();
	const credentialOwnerRole = await utils.getCredentialOwnerRole();
	saveCredential = utils.affixRoleToSaveCredential(credentialOwnerRole);
});

beforeEach(async () => {
	await utils.createOwnerShell();
});

afterEach(async () => {
	await utils.truncate(['User', 'Credentials']);
	jest.restoreAllMocks();
});

afterAll(() => {
	return getConnection().close();
});

test('POST /credentials should create cred', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
	const payload = credentialPayload();

	const response = await authOwnerAgent.post('/credentials').send(payload);

	console.log(response.body);

	expect(response.statusCode).toBe(200);

	const { id, name, type, nodesAccess, data: encryptedData } = response.body.data;

	expect(name).toBe(payload.name);
	expect(type).toBe(payload.type);
	expect(nodesAccess[0].nodeType).toBe(payload.nodesAccess[0].nodeType);
	expect(encryptedData).not.toBe(payload.data);

	const credential = await Db.collections.Credentials!.findOneOrFail(id);

	expect(credential.name).toBe(payload.name);
	expect(credential.type).toBe(payload.type);
	expect(credential.nodesAccess[0].nodeType).toBe(payload.nodesAccess[0].nodeType);
	expect(credential.data).not.toBe(payload.data);

	const sharedCredential = await Db.collections.SharedCredentials!.findOneOrFail({
		relations: ['user', 'credentials'],
		where: { credentials: credential },
	});

	expect(sharedCredential.user.id).toBe(owner.id);
	expect(sharedCredential.credentials.name).toBe(payload.name);
});

test('POST /credentials should fail with invalid inputs', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });

	for (const invalidPayload of INVALID_PAYLOADS) {
		const response = await authOwnerAgent.post('/credentials').send(invalidPayload);
		expect(response.statusCode).toBe(400);
	}
});

test('POST /credentials should fail with missing encryption key', async () => {
	const mock = jest
		.spyOn(UserSettings, 'getEncryptionKey')
		.mockImplementation(() => Promise.resolve(undefined));

	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });

	const response = await authOwnerAgent.post('/credentials').send(credentialPayload());

	expect(response.statusCode).toBe(500);

	// mock.mockRestore();
});

test('POST /credentials should ignore ID in payload', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });

	const firstResponse = await authOwnerAgent
		.post('/credentials')
		.send({ id: '8', ...credentialPayload() });

	expect(firstResponse.body.data.id).not.toBe('8');

	const secondResponse = await authOwnerAgent
		.post('/credentials')
		.send({ id: 8, ...credentialPayload() });

	expect(secondResponse.body.data.id).not.toBe(8);
});

test('DELETE /credentials/:id should delete owned cred for owner', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
	const savedCredential = await saveCredential(credentialPayload(), { user: owner });

	const response = await authOwnerAgent.delete(`/credentials/${savedCredential.id}`);

	expect(response.statusCode).toBe(200);
	expect(response.body).toEqual({ data: true });

	const deletedCredential = await Db.collections.Credentials!.findOne(savedCredential.id);

	expect(deletedCredential).toBeUndefined(); // deleted
});

test('DELETE /credentials/:id should delete non-owned cred for owner', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
	const member = await utils.createUser();
	const savedCredential = await saveCredential(credentialPayload(), { user: member });

	const response = await authOwnerAgent.delete(`/credentials/${savedCredential.id}`);

	expect(response.statusCode).toBe(200);
	expect(response.body).toEqual({ data: true });

	const deletedCredential = await Db.collections.Credentials!.findOne(savedCredential.id);

	expect(deletedCredential).toBeUndefined(); // deleted
});

test('DELETE /credentials/:id should delete owned cred for member', async () => {
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });
	const savedCredential = await saveCredential(credentialPayload(), { user: member });

	const response = await authMemberAgent.delete(`/credentials/${savedCredential.id}`);

	expect(response.statusCode).toBe(200);
	expect(response.body).toEqual({ data: true });

	const deletedCredential = await Db.collections.Credentials!.findOne(savedCredential.id);

	expect(deletedCredential).toBeUndefined(); // deleted
});

test('DELETE /credentials/:id should not delete non-owned cred for member', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });
	const savedCredential = await saveCredential(credentialPayload(), { user: owner });

	const response = await authMemberAgent.delete(`/credentials/${savedCredential.id}`);

	expect(response.statusCode).toBe(404);

	const shellCredential = await Db.collections.Credentials!.findOne(savedCredential.id);

	expect(shellCredential).toBeDefined(); // not deleted
});

test('DELETE /credentials/:id should fail if cred not found', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });

	const response = await authOwnerAgent.delete('/credentials/123');

	expect(response.statusCode).toBe(404);
});

test('PATCH /credentials/:id should update owned cred for owner', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
	const savedCredential = await saveCredential(credentialPayload(), { user: owner });
	const patchPayload = credentialPayload();

	const response = await authOwnerAgent
		.patch(`/credentials/${savedCredential.id}`)
		.send(patchPayload);

	expect(response.statusCode).toBe(200);

	const { id, name, type, nodesAccess, data: encryptedData } = response.body.data;

	expect(name).toBe(patchPayload.name);
	expect(type).toBe(patchPayload.type);
	expect(nodesAccess[0].nodeType).toBe(patchPayload.nodesAccess[0].nodeType);
	expect(encryptedData).not.toBe(patchPayload.data);

	const credential = await Db.collections.Credentials!.findOneOrFail(id);

	expect(credential.name).toBe(patchPayload.name);
	expect(credential.type).toBe(patchPayload.type);
	expect(credential.nodesAccess[0].nodeType).toBe(patchPayload.nodesAccess[0].nodeType);
	expect(credential.data).not.toBe(patchPayload.data);

	const sharedCredential = await Db.collections.SharedCredentials!.findOneOrFail({
		relations: ['user', 'credentials'],
		where: { credentials: credential },
	});

	expect(sharedCredential.credentials.name).toBe(patchPayload.name); // updated
});

test('PATCH /credentials/:id should update non-owned cred for owner', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
	const member = await utils.createUser();
	const savedCredential = await saveCredential(credentialPayload(), { user: member });
	const patchPayload = credentialPayload();

	const response = await authOwnerAgent
		.patch(`/credentials/${savedCredential.id}`)
		.send(patchPayload);

	expect(response.statusCode).toBe(200);

	const { id, name, type, nodesAccess, data: encryptedData } = response.body.data;

	expect(name).toBe(patchPayload.name);
	expect(type).toBe(patchPayload.type);
	expect(nodesAccess[0].nodeType).toBe(patchPayload.nodesAccess[0].nodeType);
	expect(encryptedData).not.toBe(patchPayload.data);

	const credential = await Db.collections.Credentials!.findOneOrFail(id);

	expect(credential.name).toBe(patchPayload.name);
	expect(credential.type).toBe(patchPayload.type);
	expect(credential.nodesAccess[0].nodeType).toBe(patchPayload.nodesAccess[0].nodeType);
	expect(credential.data).not.toBe(patchPayload.data);

	const sharedCredential = await Db.collections.SharedCredentials!.findOneOrFail({
		relations: ['user', 'credentials'],
		where: { credentials: credential },
	});

	expect(sharedCredential.credentials.name).toBe(patchPayload.name); // updated
});

test('PATCH /credentials/:id should update owned cred for member', async () => {
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });
	const savedCredential = await saveCredential(credentialPayload(), { user: member });
	const patchPayload = credentialPayload();

	const response = await authMemberAgent
		.patch(`/credentials/${savedCredential.id}`)
		.send(patchPayload);

	expect(response.statusCode).toBe(200);

	const { id, name, type, nodesAccess, data: encryptedData } = response.body.data;

	expect(name).toBe(patchPayload.name);
	expect(type).toBe(patchPayload.type);
	expect(nodesAccess[0].nodeType).toBe(patchPayload.nodesAccess[0].nodeType);
	expect(encryptedData).not.toBe(patchPayload.data);

	const credential = await Db.collections.Credentials!.findOneOrFail(id);

	expect(credential.name).toBe(patchPayload.name);
	expect(credential.type).toBe(patchPayload.type);
	expect(credential.nodesAccess[0].nodeType).toBe(patchPayload.nodesAccess[0].nodeType);
	expect(credential.data).not.toBe(patchPayload.data);

	const sharedCredential = await Db.collections.SharedCredentials!.findOneOrFail({
		relations: ['user', 'credentials'],
		where: { credentials: credential },
	});

	expect(sharedCredential.credentials.name).toBe(patchPayload.name); // updated
});

test('PATCH /credentials/:id should not update non-owned cred for member', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });
	const savedCredential = await saveCredential(credentialPayload(), { user: owner });
	const patchPayload = credentialPayload();

	const response = await authMemberAgent
		.patch(`/credentials/${savedCredential.id}`)
		.send(patchPayload);

	expect(response.statusCode).toBe(404);

	const shellCredential = await Db.collections.Credentials!.findOneOrFail(savedCredential.id);

	expect(shellCredential.name).not.toBe(patchPayload.name); // not updated
});

test('PATCH /credentials/:id should fail with invalid inputs', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
	const savedCredential = await saveCredential(credentialPayload(), { user: owner });

	for (const invalidPayload of INVALID_PAYLOADS) {
		const response = await authOwnerAgent
			.patch(`/credentials/${savedCredential.id}`)
			.send(invalidPayload);

		expect(response.statusCode).toBe(400);
	}
});

test('PATCH /credentials/:id should fail if cred not found', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });

	const response = await authOwnerAgent.patch('/credentials/123').send(credentialPayload());

	expect(response.statusCode).toBe(404);
});

// test.skip('PATCH /credentials/:id should fail with missing encryption key', async () => {
// 	const mock = jest
// 		.spyOn(UserSettings, 'getEncryptionKey')
// 		.mockImplementation(() => Promise.resolve(undefined));

// 	const owner = await Db.collections.User!.findOneOrFail();
// 	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });

// 	const response = await authOwnerAgent.post('/credentials').send(credentialPayload());

// 	expect(response.statusCode).toBe(500);

// 	mock.mockRestore();
// });

test('GET /credentials should retrieve all creds for owner', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });

	for (let i = 0; i < 3; i++) {
		await saveCredential(credentialPayload(), { user: owner });
	}

	const response = await authOwnerAgent.get('/credentials');

	expect(response.statusCode).toBe(200);
	expect(response.body.data.length).toBe(3);

	for (const credential of response.body.data) {
		const { name, type, nodesAccess, data: encryptedData } = credential;

		expect(typeof name).toBe('string');
		expect(typeof type).toBe('string');
		expect(typeof nodesAccess[0].nodeType).toBe('string');
		expect(encryptedData).toBeUndefined();
	}
});

test('GET /credentials should retrieve owned creds for member', async () => {
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });

	for (let i = 0; i < 3; i++) {
		await saveCredential(credentialPayload(), { user: member });
	}

	const response = await authMemberAgent.get('/credentials');

	expect(response.statusCode).toBe(200);
	expect(response.body.data.length).toBe(3);

	for (const credential of response.body.data) {
		const { name, type, nodesAccess, data: encryptedData } = credential;

		expect(typeof name).toBe('string');
		expect(typeof type).toBe('string');
		expect(typeof nodesAccess[0].nodeType).toBe('string');
		expect(encryptedData).toBeUndefined();
	}
});

test('GET /credentials should not retrieve non-owned creds for member', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });

	for (let i = 0; i < 3; i++) {
		await saveCredential(credentialPayload(), { user: owner });
	}

	const response = await authMemberAgent.get('/credentials');

	expect(response.statusCode).toBe(200);
	expect(response.body.data.length).toBe(0); // shell's creds not returned
});

test('GET /credentials/:id should retrieve owned cred for owner', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
	const savedCredential = await saveCredential(credentialPayload(), { user: owner });

	const firstResponse = await authOwnerAgent.get(`/credentials/${savedCredential.id}`);

	expect(firstResponse.statusCode).toBe(200);

	expect(typeof firstResponse.body.data.name).toBe('string');
	expect(typeof firstResponse.body.data.type).toBe('string');
	expect(typeof firstResponse.body.data.nodesAccess[0].nodeType).toBe('string');
	expect(firstResponse.body.data.data).toBeUndefined();

	const secondResponse = await authOwnerAgent
		.get(`/credentials/${savedCredential.id}`)
		.query({ includeData: true });

	expect(secondResponse.statusCode).toBe(200);
	expect(typeof secondResponse.body.data.name).toBe('string');
	expect(typeof secondResponse.body.data.type).toBe('string');
	expect(typeof secondResponse.body.data.nodesAccess[0].nodeType).toBe('string');
	expect(secondResponse.body.data.data).toBeDefined();
});

test('GET /credentials/:id should retrieve owned cred for member', async () => {
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });
	const savedCredential = await saveCredential(credentialPayload(), { user: member });

	const firstResponse = await authMemberAgent.get(`/credentials/${savedCredential.id}`);

	expect(firstResponse.statusCode).toBe(200);

	expect(typeof firstResponse.body.data.name).toBe('string');
	expect(typeof firstResponse.body.data.type).toBe('string');
	expect(typeof firstResponse.body.data.nodesAccess[0].nodeType).toBe('string');
	expect(firstResponse.body.data.data).toBeUndefined();

	const secondResponse = await authMemberAgent
		.get(`/credentials/${savedCredential.id}`)
		.query({ includeData: true });

	expect(secondResponse.statusCode).toBe(200);

	expect(typeof secondResponse.body.data.name).toBe('string');
	expect(typeof secondResponse.body.data.type).toBe('string');
	expect(typeof secondResponse.body.data.nodesAccess[0].nodeType).toBe('string');
	expect(secondResponse.body.data.data).toBeDefined();
});

test('GET /credentials/:id should not retrieve non-owned cred for member', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const member = await utils.createUser();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: member });
	const savedCredential = await saveCredential(credentialPayload(), { user: owner });

	const response = await authMemberAgent.get(`/credentials/${savedCredential.id}`);

	expect(response.statusCode).toBe(200);
	expect(response.body.data).toEqual({}); // shell's cred not returned
});

// test.skip('GET /credentials/:id should fail with missing encryption key', async () => {
// 	const owner = await Db.collections.User!.findOneOrFail();
// 	const authOwnerAgent = await utils.createAgent(app, { auth: true, user: owner });
// 	const savedCredential = await saveCredential(credentialPayload(), { user: owner });

// 	const mock = jest
// 		.spyOn(UserSettings, 'getEncryptionKey')
// 		.mockImplementation(() => Promise.resolve(undefined));

// 	const response = await authOwnerAgent
// 		.get(`/credentials/${savedCredential.id}`)
// 		.query({ includeData: true });

// 	expect(response.statusCode).toBe(500);

// 	mock.mockRestore();
// });

test('GET /credentials/:id should return empty if cred not found', async () => {
	const owner = await Db.collections.User!.findOneOrFail();
	const authMemberAgent = await utils.createAgent(app, { auth: true, user: owner });

	const response = await authMemberAgent.get('/credentials/789');

	expect(response.statusCode).toBe(200);
	expect(response.body).toEqual({ data: {} });
});

const credentialPayload = () => ({
	name: randomName(),
	type: randomName(),
	nodesAccess: [{ nodeType: randomName() }],
	data: { accessToken: randomString(5, 15) },
});

const INVALID_PAYLOADS = [
	{
		type: randomName(),
		nodesAccess: [{ nodeType: randomName() }],
		data: { accessToken: randomString(5, 15) },
	},
	{
		name: randomName(),
		nodesAccess: [{ nodeType: randomName() }],
		data: { accessToken: randomString(5, 15) },
	},
	{
		name: randomName(),
		type: randomName(),
		data: { accessToken: randomString(5, 15) },
	},
	{
		name: randomName(),
		type: randomName(),
		nodesAccess: [{ nodeType: randomName() }],
	},
	{},
	[],
	undefined,
];
