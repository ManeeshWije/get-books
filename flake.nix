{
  description = "get-books";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;
      in
      {
        packages = rec {
          frontend = pkgs.buildNpmPackage {
            pname = "get-books-frontend";
            version = "0.0.0";
            src = ./frontend;

            npmDepsHash = "sha256-XJsI2gDw1pv9Qpf9uAqOSXRzEBauOsBYYoeVWV2SoFY=";
            npmBuildScript = "build";

            installPhase = ''
              runHook preInstall
              mkdir -p $out/dist
              cp -r dist/* $out/dist/
              runHook postInstall
            '';
          };

          backend = pkgs.rustPlatform.buildRustPackage {
            pname = "get-books-backend";
            version = "0.1.0";
            src = ./backend;

            cargoLock.lockFile = ./backend/Cargo.lock;
          };

          app = pkgs.stdenv.mkDerivation {
            pname = "get-books-app";
            version = "0.1.0";
            dontUnpack = true;
            nativeBuildInputs = with pkgs; [ makeWrapper ];

            installPhase = ''
              runHook preInstall
              mkdir -p $out/bin $out/dist
              cp ${backend}/bin/get-books $out/bin/get-books
              cp -r ${frontend}/dist/* $out/dist/

              wrapProgram $out/bin/get-books \
                --chdir $out \
                --prefix PATH : ${lib.makeBinPath [ pkgs.kepubify ]}

              runHook postInstall
            '';
          };

          default = app;
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            rustc
            cargo
            nodejs_22
            kepubify
          ];
        };
      }
    );
}
