{
  description = "Luminous";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    zellij-mcp-server = {
      url = "github:GitJuhb/zellij-mcp-server";
      flake = false;
    };
  };

  outputs =
    { nixpkgs, zellij-mcp-server, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };

      zellij-mcp = pkgs.buildNpmPackage {
        pname = "zellij-mcp-server";
        version = "1.0.0";
        src = zellij-mcp-server;
        npmDepsHash = "sha256-NWveo/fYNIZixLIDUosiC+ItZa1mf4ZaOoPj1XLC9lQ=";
        buildPhase = ''
          npm run build
        '';
        installPhase = ''
          mkdir -p $out/lib/zellij-mcp-server $out/bin
          cp -r dist node_modules $out/lib/zellij-mcp-server/
          cat > $out/bin/zellij-mcp-server <<WRAPPER
          #!/bin/sh
          exec ${pkgs.nodejs}/bin/node $out/lib/zellij-mcp-server/dist/index.js "\$@"
          WRAPPER
          chmod +x $out/bin/zellij-mcp-server
        '';
      };

      agent-browser = pkgs.stdenv.mkDerivation rec {
        pname = "agent-browser";
        version = "0.22.3";

        src = pkgs.fetchurl {
          url = "https://registry.npmjs.org/${pname}/-/${pname}-${version}.tgz";
          hash = "sha256-hzHQ+yqoVpe+7tsxDnBrS3tmJk0aVQ80yCQGT5Il6Wk=";
        };

        sourceRoot = ".";

        nativeBuildInputs = [ pkgs.autoPatchelfHook ];
        buildInputs = [ pkgs.stdenv.cc.cc.lib ];

        dontBuild = true;

        installPhase = ''
          mkdir -p $out/bin
          cp package/bin/agent-browser-linux-x64 $out/bin/agent-browser
          chmod +x $out/bin/agent-browser
        '';
      };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          bun
          nodejs
          turbo
          agent-browser
          zellij-mcp
        ];
      };
    };
}
