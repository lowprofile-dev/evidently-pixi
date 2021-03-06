import * as PIXI from 'pixi.js';

export interface TilesetTextureConfig {
	offsetX: number;
	offsetY: number;
	tileWidth: number;
	tileHeight: number;
	spacingX: number;
	spacingY: number;
}

function assertTilesetConfigField(config: TilesetTextureConfig, expectedLowerBound: number, fieldName: Extract<keyof TilesetTextureConfig, string>): void {
	if (config[fieldName] < expectedLowerBound) {
		throw new Error(`${fieldName} expected to be equal or larger to ${expectedLowerBound}, '${config[fieldName]}' given instead.`);
	}
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * Provides simple API for retrieving texture by name, by a segment of a texture or by a tile in a tileset.
 *
 * The goal is to have a centralized source of textures that can be easily accessed just by a string. Simplifies
 * serialization among other things.
 *
 * To use this, a texture first has to be registered with a name, then you can access it by one of the many ways.
 * A tileset can also be registered in which case its tiles can be retrieved via `getTile()`.
 *
 * Note: `TextureStore` never creates new BaseTextures. What it means is that for the purpose of performance, all the textures
 * created from the same base texture are still part of that base texture, part of the same texture atlas.
 */
export class TextureStore {
	private readonly _separator: string;
	private readonly _separatorRemovalRegex: RegExp;
	private readonly nameToTextureMap: Map<string, PIXI.Texture> = new Map();
	private readonly textureToNameMap: Map<PIXI.Texture, string> = new Map();
	private readonly nameToTilesetConfigMap: Map<string, TilesetTextureConfig> = new Map();

	/**
	 * Separator used to delimit properties of a dynamic texture rectangle
	 */
	public get separator(): string {
		return this._separator;
	}

	/**
	 * Creates a new Texture Factory.
	 *
	 * @param {string="/"} separator Used to delimit properties of a texture rectangle
	 * @throws {Error} Thrown when separator's length is different than 1 character.
	 */
	public constructor(separator = '/') {
		if (separator.length !== 1) {
			throw new Error("Separator must always be of length 1.");
		}

		this._separator = separator;
		this._separatorRemovalRegex = new RegExp(`${escapeRegExp(separator)}.+`);
	}

	/**
	 * Registers a texture for use in the factory.
	 *
	 * @param {PIXI.Texture} texture Texture to register
	 * @param {string} name Name of the texture to use for access
	 * @throws {Error} Thrown when texture name contains the separator provided in the constructor.
	 */
	public registerTexture(texture: PIXI.Texture, name: string): void {
		if (name.indexOf(this.separator) !== -1) {
			throw new Error(`Cannot register a texture that contains the separator character '${this.separator}' in its name.`);
		}
		this.nameToTextureMap.set(name, texture);
		this.textureToNameMap.set(texture, name);
	}

	/**
	 * Registers a previously registered texture as a tileset, to allow using it with `getTile()` method. The texture can still be used
	 * the same way it was used previously.
	 *
	 * @param {string} textureName Name of the texture to use as the basis for the tileset
	 * @param {TilesetTextureConfig} config Tileset configuration
	 * @throwns {Error} Thrown when you try to register tileset for `textureName` that was not previously registered.
	 * @throwns {Error} Thrown when you try to register tileset for `textureName` that was already registered as tileset.
	 */
	public registerTileset(textureName: string, config: TilesetTextureConfig): void {
		if (!this.nameToTextureMap.has(textureName)) {
			throw new Error(`Cannot register tileset for not-registered texture '${textureName}'.`);
		}

		if (this.nameToTilesetConfigMap.has(textureName)) {
			throw new Error(`Tileset for texture '${textureName}' is already defined!`);
		}

		assertTilesetConfigField(config, 0, 'offsetX');
		assertTilesetConfigField(config, 0, 'offsetY');
		assertTilesetConfigField(config, 0, 'spacingX');
		assertTilesetConfigField(config, 0, 'spacingY');
		assertTilesetConfigField(config, 1, 'tileWidth');
		assertTilesetConfigField(config, 1, 'tileHeight');

		this.nameToTilesetConfigMap.set(textureName, {...config});
	}

	/**
	 * Given a texture previously extracted from this factory returns its name. Most useful to get the generated name
	 * of textures from `getTile()` or `getTextureRectangle()`.
	 *
	 * @param {string} texture Texture which name to get
	 * @return {string} Name of the texture
	 * @throws {Error} Thrown when texture was not previously registered nor generated.
	 */
	public getTextureName(texture: PIXI.Texture): string {
		const name = this.textureToNameMap.get(texture);

		if (!name) {
			throw new Error("Texture was not registered.");
		}

		return name;
	}

	/**
	 * Retrieves a texture by name, where the name can be either a base name of a texture or one with the additional properties,
	 * as generated by `getTextureRectangle()` or `getTile()`.
	 * If a name with properties is passed and that texture was not previously generated in this factory it'll work exactly the same
	 * as if calling `getTextureRectangle()` with the basename and rectangle extracted.
	 *
	 * @param {string} name Name of the texture to retrieve
	 * @return {PIXI.Texture} The texture for the name
	 * @throws {Error} Thrown when texture for the given name was not found and did not have the valid number of properties.
	 * @throws {Error} Thrown when the width or height in the texture name's properties is less than 1
	 */
	public getTexture(name: string): PIXI.Texture {
		const texture = this.nameToTextureMap.get(name);

		if (!texture) {
			const pieces = name.split(this.separator);

			if (pieces.length === 5) {
				const [baseName, x, y, width, height] = pieces;
				return this.getTextureRectangle(baseName, parseInt(x), parseInt(y), parseInt(width), parseInt(height));
			} else {
				throw new Error(`Unknown texture '${name}'`);
			}
		}

		return texture;
	}

	/**
	 * Retrieves a rectangle from a previously registered texture or a valid texture rectangle. If the name provided is
	 * a texture rectangle, the position provided will be relative to that rectangle's frame, not the base texture's frame.
	 *
	 * @param {string} name Name of the texture to use as a basis
	 * @param {number} x Offset X position from the top-left corner of the texture's frame
	 * @param {number} y Offset Y position from the top-left corner of the texture's frame
	 * @param {number} width Width of the new texture
	 * @param {number} height Height of the new texture
	 * @return {PIXI.Texture} The new texture that matches the specified frame.
	 * @throws {Error} Thrown when either width or height is less than 1
	 */
	public getTextureRectangle(name: string, x: number, y: number, width: number, height: number): PIXI.Texture {
		const texture = this.getTexture(name);
		const baseName = name.replace(this._separatorRemovalRegex, '');
		const baseTexture = this.getTexture(baseName);

		if (width <= 0) {
			throw new Error("Width must be a positive integer");
		}
		if (height <= 0) {
			throw new Error("Height must be a positive integer");
		}

		const newTexture = new PIXI.Texture(
			texture.baseTexture,
			new PIXI.Rectangle(texture.frame.x + x, texture.frame.y + y, width, height),
		);

		const newName = [
			baseName,
			newTexture.frame.x - baseTexture.frame.x,
			newTexture.frame.y - baseTexture.frame.y,
			width,
			height
		].join(this.separator);
		this.nameToTextureMap.set(newName, newTexture);
		this.textureToNameMap.set(newTexture, newName);

		return newTexture;
	}

	/**
	 * Retrieves a texture that matches a tile at the given position in the tileset.
	 *
	 * @param {string} name Name of the tileset to use.
	 * @param {number} x X position of the tile
	 * @param {number} y Y position of the tile
	 * @return {PIXI.Texture} The texture for the requested tile
	 * @throws {Error} Thrown when the name of the texture was not registered as a tileset.
	 */
	public getTile(name: string, x: number, y: number): PIXI.Texture {
		const config = this.nameToTilesetConfigMap.get(name);

		if (!config) {
			throw new Error(`No tileset registered for texture '${name}'.`);
		}

		const expectedX = config.offsetX + x * (config.tileWidth + config.spacingX);
		const expectedY = config.offsetY + y * (config.tileHeight + config.spacingY);

		return this.getTextureRectangle(name, expectedX, expectedY, config.tileWidth, config.tileHeight);
	}
}